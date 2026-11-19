const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeTrainingImport } = require("./training-import");

test("imports prompt/completion and chat messages formats", () => {
  const result = normalizeTrainingImport([
    {prompt:"Was ist KI?",completion:"KI ist ein technisches Forschungsfeld."},
    {messages:[{role:"user",content:"Erkläre Code."},{role:"assistant",content:"Code sind Anweisungen."}]}
  ]);
  assert.equal(result.length,2);
  assert.equal(result[1].prompt,"Erkläre Code.");
});

test("trims and removes duplicate examples", () => {
  const result = normalizeTrainingImport([
    {prompt:"  Frage? ",completion:" Antwort "},
    {prompt:"frage?",completion:"antwort"}
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].completion,"Antwort");
});

test("rejects missing fields, invalid lengths and more than 100 rows", () => {
  assert.throws(() => normalizeTrainingImport([{prompt:"Hi"}]), /Nutzerfrage/);
  assert.throws(() => normalizeTrainingImport([{prompt:"x",completion:"y"}]), /Textlängen/);
  assert.throws(() => normalizeTrainingImport(Array.from({length:101},()=>({prompt:"Frage?",completion:"Antwort"}))), /1 und 100/);
});
