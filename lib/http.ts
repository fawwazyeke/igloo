// Stop reading as soon as a streamed request exceeds the character limit.
export async function readBody(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // A UTF-8 chunk cannot decode to fewer than one UTF-16 unit per three bytes.
      if (value.byteLength > (limit - text.length + 1) * 3) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) {
        await reader.cancel();
        return null;
      }
    }
    text += decoder.decode();
    return text.length <= limit ? text : null;
  } finally {
    reader.releaseLock();
  }
}
