/**
 * Validate imported chat fine-tuning examples. Imported rows are always pending review.
 * Accepted formats: {prompt, completion} or OpenAI-style {messages:[{role,content}, ...]}.
 */
function normalizeTrainingImport(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 100) {
    throw new Error("Der Import muss zwischen 1 und 100 Beispielen enthalten.");
  }
  const seen = new Set();
  const output = [];
  for (let index = 0; index < input.length; index += 1) {
    const row = input[index];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Beispiel " + (index + 1) + " ist kein gültiges Objekt.");
    }
    let prompt = row.prompt;
    let completion = row.completion;
    if (Array.isArray(row.messages)) {
      const user = row.messages.find(message => message && message.role === "user" && typeof message.content === "string");
      const assistant = [...row.messages].reverse().find(message => message && message.role === "assistant" && typeof message.content === "string");
      prompt = user?.content;
      completion = assistant?.content;
    }
    if (typeof prompt !== "string" || typeof completion !== "string") {
      throw new Error("Beispiel " + (index + 1) + " braucht eine Nutzerfrage und eine Assistentenantwort.");
    }
    prompt = prompt.trim();
    completion = completion.trim();
    if (prompt.length < 3 || prompt.length > 6000 || completion.length < 2 || completion.length > 8000) {
      throw new Error("Beispiel " + (index + 1) + " überschreitet die erlaubten Textlängen.");
    }
    const key = prompt.toLocaleLowerCase("de-DE") + "\u0000" + completion.toLocaleLowerCase("de-DE");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({prompt,completion});
  }
  if (!output.length) throw new Error("Der Import enthält keine eindeutigen Beispiele.");
  return output;
}

module.exports = { normalizeTrainingImport };
