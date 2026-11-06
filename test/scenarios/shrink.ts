/** Delete chunks only when replay preserves all preconditions and failure identity. */
export async function shrinkFailure<T>(sequence: T[], signature: string, replay: (candidate: T[]) => Promise<string | null>) {
  let result = sequence.slice()
  for (let size = Math.max(1, Math.floor(result.length / 2)); size >= 1; size = Math.floor(size / 2)) {
    let start = 0
    while (start + size <= result.length) {
      const candidate = [...result.slice(0, start), ...result.slice(start + size)]
      if (await replay(candidate) === signature) result = candidate
      else start += size
    }
  }
  return result
}
