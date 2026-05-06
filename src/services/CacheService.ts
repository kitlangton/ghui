import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-bun"
import { Context, Effect, Layer, Schema } from "effect"
import * as Migrator from "effect/unstable/sql/Migrator"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"
import { checkConclusions, checkRollupStatuses, checkRunStatuses, pullRequestQueueModes, pullRequestStates, reviewStatuses, type PullRequestItem } from "../domain.js"
import { mergeCachedDetails } from "../pullRequestCache.js"
import type { PullRequestLoad } from "../pullRequestLoad.js"
import { type PullRequestView, viewCacheKey } from "../pullRequestViews.js"

export interface PullRequestCacheKey {
	readonly repository: string
	readonly number: number
}

export class CacheError extends Schema.TaggedErrorClass<CacheError>()("CacheError", {
	operation: Schema.String,
	cause: Schema.Defect,
}) {}

const CheckConclusionSchema = Schema.Literals(checkConclusions)
const CheckRunStatusSchema = Schema.Literals(checkRunStatuses)
const CheckRollupStatusSchema = Schema.Literals(checkRollupStatuses)
const PullRequestStateSchema = Schema.Literals(pullRequestStates)
const ReviewStatusSchema = Schema.Literals(reviewStatuses)

const CachedPullRequestLabelSchema = Schema.Struct({
	name: Schema.String,
	color: Schema.NullOr(Schema.String),
})

const CachedCheckItemSchema = Schema.Struct({
	name: Schema.String,
	status: CheckRunStatusSchema,
	conclusion: Schema.NullOr(CheckConclusionSchema),
})

const CachedPullRequestItemSchema = Schema.Struct({
	repository: Schema.String,
	author: Schema.String,
	headRefOid: Schema.String,
	headRefName: Schema.optionalKey(Schema.String),
	number: Schema.Number,
	title: Schema.String,
	body: Schema.String,
	labels: Schema.Array(CachedPullRequestLabelSchema),
	additions: Schema.Number,
	deletions: Schema.Number,
	changedFiles: Schema.Number,
	state: PullRequestStateSchema,
	reviewStatus: ReviewStatusSchema,
	checkStatus: CheckRollupStatusSchema,
	checkSummary: Schema.NullOr(Schema.String),
	checks: Schema.Array(CachedCheckItemSchema),
	autoMergeEnabled: Schema.Boolean,
	detailLoaded: Schema.Boolean,
	createdAt: Schema.String,
	closedAt: Schema.NullOr(Schema.String),
	url: Schema.String,
})

const CachedPullRequestViewSchema = Schema.Union([
	Schema.Struct({ _tag: Schema.tag("Queue"), mode: Schema.Literals(pullRequestQueueModes), repository: Schema.NullOr(Schema.String) }),
	Schema.Struct({ _tag: Schema.tag("Repository"), repository: Schema.String }),
])

type CachedPullRequestItem = Schema.Schema.Type<typeof CachedPullRequestItemSchema>

interface PullRequestRow {
	readonly pr_key: string
	readonly data_json: string
}

interface QueueSnapshotRow {
	readonly view_json: string
	readonly pr_keys_json: string
	readonly fetched_at: string
	readonly end_cursor: string | null
	readonly has_next_page: number
}

export const pullRequestCacheKey = ({ repository, number }: PullRequestCacheKey) => `${repository}#${number}`

const parseDate = (value: string) => {
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? null : date
}

const parseJson = (operation: string, json: string) =>
	Effect.try({
		try: () => JSON.parse(json) as unknown,
		catch: (cause) => new CacheError({ operation, cause }),
	})

const decodeCached = <S extends Schema.Top>(operation: string, schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value).pipe(Effect.mapError((cause) => new CacheError({ operation, cause })))

const toCacheError = (operation: string, cause: unknown) => (cause instanceof CacheError ? cause : new CacheError({ operation, cause }))

const cachedPullRequestToDomain = (cached: CachedPullRequestItem): PullRequestItem | null => {
	const createdAt = parseDate(cached.createdAt)
	if (!createdAt) return null
	const closedAt = cached.closedAt === null ? null : parseDate(cached.closedAt)
	if (cached.closedAt !== null && !closedAt) return null
	return {
		repository: cached.repository,
		author: cached.author,
		headRefOid: cached.headRefOid,
		headRefName: cached.headRefName ?? "",
		number: cached.number,
		title: cached.title,
		body: cached.body,
		labels: cached.labels,
		additions: cached.additions,
		deletions: cached.deletions,
		changedFiles: cached.changedFiles,
		state: cached.state,
		reviewStatus: cached.reviewStatus,
		checkStatus: cached.checkStatus,
		checkSummary: cached.checkSummary,
		checks: cached.checks,
		autoMergeEnabled: cached.autoMergeEnabled,
		detailLoaded: cached.detailLoaded,
		createdAt,
		closedAt,
		url: cached.url,
	}
}

const encodePullRequest = (pullRequest: PullRequestItem): CachedPullRequestItem => ({
	repository: pullRequest.repository,
	author: pullRequest.author,
	headRefOid: pullRequest.headRefOid,
	headRefName: pullRequest.headRefName,
	number: pullRequest.number,
	title: pullRequest.title,
	body: pullRequest.body,
	labels: pullRequest.labels,
	additions: pullRequest.additions,
	deletions: pullRequest.deletions,
	changedFiles: pullRequest.changedFiles,
	state: pullRequest.state,
	reviewStatus: pullRequest.reviewStatus,
	checkStatus: pullRequest.checkStatus,
	checkSummary: pullRequest.checkSummary,
	checks: pullRequest.checks,
	autoMergeEnabled: pullRequest.autoMergeEnabled,
	detailLoaded: pullRequest.detailLoaded,
	createdAt: pullRequest.createdAt.toISOString(),
	closedAt: pullRequest.closedAt?.toISOString() ?? null,
	url: pullRequest.url,
})

const decodePullRequestJson = (json: string): Effect.Effect<PullRequestItem, CacheError> =>
	Effect.gen(function* () {
		const value = yield* parseJson("decodePullRequest", json)
		const cached = yield* decodeCached("decodePullRequest", CachedPullRequestItemSchema, value)
		const pullRequest = cachedPullRequestToDomain(cached)
		if (!pullRequest) return yield* new CacheError({ operation: "decodePullRequest", cause: "invalid cached date" })
		return pullRequest
	})

const decodePullRequestViewJson = (json: string): Effect.Effect<PullRequestView, CacheError> =>
	Effect.gen(function* () {
		const value = yield* parseJson("decodePullRequestView", json)
		const view = yield* decodeCached("decodePullRequestView", CachedPullRequestViewSchema, value)
		return view
	})

const decodeStringArrayJson = (json: string): Effect.Effect<readonly string[], CacheError> =>
	Effect.gen(function* () {
		const value = yield* parseJson("decodeQueueKeys", json)
		return yield* decodeCached("decodeQueueKeys", Schema.Array(Schema.String), value)
	})

const dateFromCache = (operation: string, value: string) => {
	const date = parseDate(value)
	return date ? Effect.succeed(date) : Effect.fail(new CacheError({ operation, cause: `Invalid cached date: ${value}` }))
}

const applyPragmas = Effect.gen(function* () {
	const sql = yield* SqlClient.SqlClient
	yield* sql`PRAGMA synchronous = NORMAL`
	yield* sql`PRAGMA busy_timeout = 5000`
	yield* sql`PRAGMA foreign_keys = ON`
	yield* sql`PRAGMA temp_store = MEMORY`
	yield* sql`PRAGMA journal_size_limit = 16777216`
})

const cacheMigrations = {
	"001_initial_cache_schema": Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		yield* sql`CREATE TABLE IF NOT EXISTS pull_requests (
			pr_key TEXT PRIMARY KEY,
			repository TEXT NOT NULL,
			number INTEGER NOT NULL,
			url TEXT NOT NULL,
			head_ref_oid TEXT NOT NULL,
			state TEXT NOT NULL,
			detail_loaded INTEGER NOT NULL,
			data_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`
		yield* sql`CREATE INDEX IF NOT EXISTS pull_requests_repository_number_idx ON pull_requests (repository, number)`
		yield* sql`CREATE TABLE IF NOT EXISTS queue_snapshots (
			viewer TEXT NOT NULL,
			view_key TEXT NOT NULL,
			view_json TEXT NOT NULL,
			pr_keys_json TEXT NOT NULL,
			fetched_at TEXT NOT NULL,
			end_cursor TEXT,
			has_next_page INTEGER NOT NULL,
			PRIMARY KEY (viewer, view_key)
		)`
	}),
} satisfies Record<string, Effect.Effect<void, unknown, SqlClient.SqlClient>>

const pullRequestRow = (pullRequest: PullRequestItem, updatedAt = new Date().toISOString()) => ({
	pr_key: pullRequestCacheKey(pullRequest),
	repository: pullRequest.repository,
	number: pullRequest.number,
	url: pullRequest.url,
	head_ref_oid: pullRequest.headRefOid,
	state: pullRequest.state,
	detail_loaded: pullRequest.detailLoaded ? 1 : 0,
	data_json: JSON.stringify(encodePullRequest(pullRequest)),
	updated_at: updatedAt,
})

const upsertPullRequestRowsSql = (sql: SqlClient.SqlClient, pullRequests: readonly PullRequestItem[]): Effect.Effect<void, SqlError> => {
	if (pullRequests.length === 0) return Effect.void
	const updatedAt = new Date().toISOString()
	const rows = pullRequests.map((pullRequest) => pullRequestRow(pullRequest, updatedAt))
	return sql`INSERT INTO pull_requests ${sql.insert(rows)}
		ON CONFLICT(pr_key) DO UPDATE SET
			repository = excluded.repository,
			number = excluded.number,
			url = excluded.url,
			head_ref_oid = excluded.head_ref_oid,
			state = excluded.state,
			detail_loaded = excluded.detail_loaded,
			data_json = excluded.data_json,
			updated_at = excluded.updated_at`.pipe(Effect.asVoid)
}

const upsertPullRequestSql = (sql: SqlClient.SqlClient, pullRequest: PullRequestItem) => upsertPullRequestRowsSql(sql, [pullRequest])

const readPullRequestSql = (sql: SqlClient.SqlClient, key: PullRequestCacheKey) =>
	Effect.gen(function* () {
		const rows = yield* sql<PullRequestRow>`SELECT pr_key, data_json FROM pull_requests WHERE pr_key = ${pullRequestCacheKey(key)} LIMIT 1`
		const row = rows[0]
		if (!row) return null
		return yield* decodePullRequestJson(row.data_json)
	})

const pruneSql = (sql: SqlClient.SqlClient) => {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
	return Effect.gen(function* () {
		yield* sql`DELETE FROM queue_snapshots WHERE fetched_at < ${cutoff}`
		yield* sql`DELETE FROM pull_requests
			WHERE updated_at < ${cutoff}
			AND pr_key NOT IN (
				SELECT value FROM queue_snapshots, json_each(queue_snapshots.pr_keys_json)
			)`
	}).pipe(Effect.catch(() => Effect.void))
}

const liveCacheService = (sql: SqlClient.SqlClient) => {
	const readQueue = (viewer: string, view: PullRequestView): Effect.Effect<PullRequestLoad | null, CacheError> =>
		Effect.gen(function* () {
			const rows =
				yield* sql<QueueSnapshotRow>`SELECT view_json, pr_keys_json, fetched_at, end_cursor, has_next_page FROM queue_snapshots WHERE viewer = ${viewer} AND view_key = ${viewCacheKey(view)} LIMIT 1`
			const snapshot = rows[0]
			if (!snapshot) return null

			const [cachedView, prKeys, fetchedAt] = yield* Effect.all([
				decodePullRequestViewJson(snapshot.view_json),
				decodeStringArrayJson(snapshot.pr_keys_json),
				dateFromCache("decodeQueue", snapshot.fetched_at),
			])
			if (viewCacheKey(cachedView) !== viewCacheKey(view)) return null
			if (prKeys.length === 0) {
				return {
					view,
					data: [],
					fetchedAt,
					endCursor: snapshot.end_cursor,
					hasNextPage: snapshot.has_next_page === 1,
				} satisfies PullRequestLoad
			}

			const prRows = yield* sql<PullRequestRow>`SELECT pr_key, data_json FROM pull_requests WHERE pr_key IN ${sql.in(prKeys)}`
			const byKey = new Map<string, PullRequestItem>()
			for (const row of prRows) {
				const decoded = yield* decodePullRequestJson(row.data_json).pipe(Effect.catch(() => Effect.succeed(null)))
				if (decoded) byKey.set(row.pr_key, decoded)
			}
			const data = prKeys.flatMap((key: string) => {
				const pullRequest = byKey.get(key)
				return pullRequest ? [pullRequest] : []
			})

			return {
				view,
				data,
				fetchedAt,
				endCursor: snapshot.end_cursor,
				hasNextPage: snapshot.has_next_page === 1,
			} satisfies PullRequestLoad
		}).pipe(Effect.mapError((cause) => toCacheError("readQueue", cause)))

	const writeQueue = Effect.fn("CacheService.writeQueue")(function* (viewer: string, load: PullRequestLoad) {
		const fetchedAt = load.fetchedAt ?? new Date()
		const write = Effect.gen(function* () {
			if (load.data.length > 0) {
				const keys = load.data.map(pullRequestCacheKey)
				const existingRows = yield* sql<PullRequestRow>`SELECT pr_key, data_json FROM pull_requests WHERE pr_key IN ${sql.in(keys)}`
				const existing: PullRequestItem[] = []
				for (const row of existingRows) {
					const decoded = yield* decodePullRequestJson(row.data_json).pipe(Effect.catch(() => Effect.succeed(null)))
					if (decoded) existing.push(decoded)
				}
				yield* upsertPullRequestRowsSql(sql, mergeCachedDetails(load.data, existing))
			}
			const snapshot = {
				viewer,
				view_key: viewCacheKey(load.view),
				view_json: JSON.stringify(load.view),
				pr_keys_json: JSON.stringify(load.data.map(pullRequestCacheKey)),
				fetched_at: fetchedAt.toISOString(),
				end_cursor: load.endCursor,
				has_next_page: load.hasNextPage ? 1 : 0,
			}
			yield* sql`INSERT INTO queue_snapshots ${sql.insert(snapshot)}
				ON CONFLICT(viewer, view_key) DO UPDATE SET
					view_json = excluded.view_json,
					pr_keys_json = excluded.pr_keys_json,
					fetched_at = excluded.fetched_at,
					end_cursor = excluded.end_cursor,
					has_next_page = excluded.has_next_page`
		})
		const wrote = yield* sql.withTransaction(write).pipe(
			Effect.as(true),
			Effect.catch(() => Effect.succeed(false)),
		)
		if (wrote) yield* pruneSql(sql)
	})

	const readPullRequest = (key: PullRequestCacheKey): Effect.Effect<PullRequestItem | null, CacheError> =>
		readPullRequestSql(sql, key).pipe(Effect.mapError((cause) => toCacheError("readPullRequest", cause)))

	const upsertPullRequest = Effect.fn("CacheService.upsertPullRequest")(function* (pullRequest: PullRequestItem) {
		yield* upsertPullRequestSql(sql, pullRequest).pipe(Effect.catch(() => Effect.void))
	})

	const prune = Effect.fn("CacheService.prune")(function* () {
		yield* pruneSql(sql)
	})

	return { readQueue, writeQueue, readPullRequest, upsertPullRequest, prune }
}

export class CacheService extends Context.Service<
	CacheService,
	{
		readonly readQueue: (viewer: string, view: PullRequestView) => Effect.Effect<PullRequestLoad | null, CacheError>
		readonly writeQueue: (viewer: string, load: PullRequestLoad) => Effect.Effect<void>
		readonly readPullRequest: (key: PullRequestCacheKey) => Effect.Effect<PullRequestItem | null, CacheError>
		readonly upsertPullRequest: (pullRequest: PullRequestItem) => Effect.Effect<void>
		readonly prune: () => Effect.Effect<void>
	}
>()("ghui/CacheService") {
	static readonly disabledLayer = Layer.succeed(
		CacheService,
		CacheService.of({
			readQueue: () => Effect.succeed(null),
			writeQueue: () => Effect.void,
			readPullRequest: () => Effect.succeed(null),
			upsertPullRequest: () => Effect.void,
			prune: () => Effect.void,
		}),
	)

	static readonly layerSqlite = Layer.effect(
		CacheService,
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return CacheService.of(liveCacheService(sql))
		}),
	)

	static readonly layerSqliteFile = (filename: string): Layer.Layer<CacheService, SqlError | Migrator.MigrationError | CacheError> => {
		const sqlLayer = SqliteClient.layer({ filename })
		const setupLayer = Layer.effectDiscard(
			Effect.gen(function* () {
				yield* applyPragmas
				yield* SqliteMigrator.run({ loader: Migrator.fromRecord(cacheMigrations), table: "ghui_cache_migrations" })
			}),
		)
		const liveLayer = Layer.mergeAll(setupLayer, CacheService.layerSqlite).pipe(Layer.provide(sqlLayer))
		return Layer.unwrap(
			Effect.tryPromise({
				try: () => mkdir(dirname(filename), { recursive: true }),
				catch: (cause) => new CacheError({ operation: "createCacheDirectory", cause }),
			}).pipe(Effect.as(liveLayer)),
		)
	}

	static readonly layerFromPath = (filename: string | null): Layer.Layer<CacheService> =>
		filename === null ? CacheService.disabledLayer : CacheService.layerSqliteFile(filename).pipe(Layer.catchCause(() => CacheService.disabledLayer))
}
