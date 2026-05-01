import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { config } from "../config.js"
import type { PullRequestItem } from "../domain.js"

const SCHEMA_VERSION = 1

interface PrRow { readonly data: string }
interface VersionRow { readonly value: string }

const parsePullRequest = (data: string): PullRequestItem => {
	const raw = JSON.parse(data) as PullRequestItem & { readonly createdAt: string; readonly closedAt: string | null }
	return { ...raw, createdAt: new Date(raw.createdAt), closedAt: raw.closedAt ? new Date(raw.closedAt) : null }
}

export class SqliteCacheService {
	private readonly db: Database

	private constructor(path: string) {
		mkdirSync(dirname(path), { recursive: true })
		this.db = new Database(path)
		this.migrate()
	}

	static open(path = config.cachePath): SqliteCacheService | null {
		try {
			return new SqliteCacheService(path)
		} catch {
			return null
		}
	}

	readPullRequests(scope = config.author): readonly PullRequestItem[] {
		try {
			const rows = this.db.query<PrRow, [string]>("select data from pull_requests where scope = ? order by created_at desc").all(scope)
			return rows.map((row) => parsePullRequest(row.data))
		} catch {
			return []
		}
	}

	writePullRequests(items: readonly PullRequestItem[], scope = config.author): void {
		try {
			const transaction = this.db.transaction((pullRequests: readonly PullRequestItem[]) => {
				this.db.query("delete from pull_requests where scope = ?").run(scope)
				const insert = this.db.query("insert into pull_requests (scope, repository, number, created_at, data) values (?, ?, ?, ?, ?)")
				for (const pr of pullRequests) {
					insert.run(scope, pr.repository, pr.number, pr.createdAt.toISOString(), JSON.stringify(pr))
				}
			})
			transaction(items)
		} catch {
			// Cache writes should never interrupt UI updates.
		}
	}

	private migrate(): void {
		this.db.run("create table if not exists cache_meta (key text primary key, value text not null)")
		const version = this.db.query<VersionRow, []>("select value from cache_meta where key = 'schema_version'").get()
		if (version && Number(version.value) !== SCHEMA_VERSION) {
			this.db.run("drop table if exists pull_requests")
		}
		this.db.run("create table if not exists pull_requests (scope text not null, repository text not null, number integer not null, created_at text not null, data text not null, primary key (scope, repository, number))")
		this.db.run("insert into cache_meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value", [String(SCHEMA_VERSION)])
	}
}
