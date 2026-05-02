const hasStringField = <K extends string>(value: object, key: K): value is { [P in K]: string } & object =>
	key in value && typeof (value as Record<string, unknown>)[key] === "string"

export const errorMessage = (error: unknown): string => {
	if (typeof error === "object" && error !== null) {
		if (hasStringField(error, "detail") && error.detail.length > 0) return error.detail
		if (hasStringField(error, "message") && error.message.length > 0) return error.message
	}
	return error instanceof Error ? error.message : String(error)
}
