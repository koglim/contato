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

test("does not select questions, refusals or hypothetical statements", () => {
  for (const text of [
    "não quero a Ana",
    "A Ana atende domingo?",
    "quanto cobra a Ana?",
    "se a Ana atender hoje eu escolho ela",
  ]) {
    assert.deepEqual(resolveProfessionalSelection(text, options), { kind: "unresolved" }, text);
  }
});

test("does not guess an unknown surname or mix different references", () => {
  assert.deepEqual(resolveProfessionalSelection("Ana Paula", [{ rankPosition: 1, displayName: "Ana Souza" }]), { kind: "unresolved" });
  assert.equal(resolveProfessionalSelection("opção 1 ou João", options).kind, "unresolved");
  assert.equal(resolveProfessionalSelection("Ana Souza e Ana", [
    { rankPosition: 1, displayName: "Ana Souza" },
    { rankPosition: 3, displayName: "Ana Silva" },
  ]).kind, "ambiguous");
  assert.equal(resolveProfessionalSelection("Ana Souza ou Ana Paula", [
    { rankPosition: 1, displayName: "Ana Souza" },
  ]).kind, "unresolved");
});

test("prefers the longest presented full name when names overlap", () => {
  const overlapping = [
    { rankPosition: 1, displayName: "João Silva" },
    { rankPosition: 2, displayName: "João Silva Junior" },
  ];
  assert.deepEqual(resolveProfessionalSelection("João Silva Junior", overlapping), { kind: "selected", position: 2 });
  assert.deepEqual(resolveProfessionalSelection("quero o João Silva Junior", overlapping), { kind: "selected", position: 2 });
});

test("does not emit one-option ambiguity for consistent or incomplete references", () => {
  assert.deepEqual(resolveProfessionalSelection("Ana opção 1", options), { kind: "selected", position: 1 });
  assert.deepEqual(resolveProfessionalSelection("quero a Ana opção 1", options), { kind: "selected", position: 1 });
  assert.deepEqual(resolveProfessionalSelection("quero uma Ana", options), { kind: "selected", position: 1 });
  assert.deepEqual(resolveProfessionalSelection("quero um João", options), { kind: "selected", position: 2 });
  assert.deepEqual(resolveProfessionalSelection("Ana opção 2", options), { kind: "unresolved" });
  assert.notEqual(resolveProfessionalSelection("Ana opção 1", options).kind, "ambiguous");
});

test("never resolves an unshown or unranked match", () => {
  assert.deepEqual(resolveProfessionalSelection("Carlos", [{ rankPosition: null, displayName: "Carlos" }]), { kind: "unresolved" });
});
