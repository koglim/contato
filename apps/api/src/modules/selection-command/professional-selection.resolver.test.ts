import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfessionalSelection } from "./professional-selection.resolver.js";

const options = [
  { rankPosition: 1, displayName: "Ana Souza" },
  { rankPosition: 2, displayName: "João Silva" },
  { rankPosition: 3, displayName: "Ricardo Santos" },
];

test("resolves exact, first-name and natural phrase selections", () => {
  for (const [text, position] of [
    ["Ana Souza", 1],
    ["Ana", 1],
    ["quero a Ana", 1],
    ["pode ser o João", 2],
    ["escolho Ricardo Santos", 3],
    ["vou com o Ricardo", 3],
  ] as const) {
    assert.deepEqual(resolveProfessionalSelection(text, options), { kind: "selected", position });
  }
});

test("ignores case, accents, punctuation and protects word boundaries", () => {
  assert.deepEqual(resolveProfessionalSelection("joao!!!", options), { kind: "selected", position: 2 });
  assert.deepEqual(resolveProfessionalSelection("quero a ANA.", options), { kind: "selected", position: 1 });
  assert.deepEqual(resolveProfessionalSelection("Mariana", options), { kind: "unresolved" });
});

test("returns ambiguity for repeated first names and multiple names", () => {
  const repeated = [
    { rankPosition: 1, displayName: "Ana Souza" },
    { rankPosition: 3, displayName: "Ana Silva" },
  ];
  assert.deepEqual(resolveProfessionalSelection("Ana", repeated), {
    kind: "ambiguous",
    options: [
      { position: 1, professionalDisplayName: "Ana Souza" },
      { position: 3, professionalDisplayName: "Ana Silva" },
    ],
  });
  assert.equal(resolveProfessionalSelection("Ana e João", options).kind, "ambiguous");
});

test("never resolves an unshown or unranked match", () => {
  assert.deepEqual(resolveProfessionalSelection("Carlos", [{ rankPosition: null, displayName: "Carlos" }]), { kind: "unresolved" });
});
