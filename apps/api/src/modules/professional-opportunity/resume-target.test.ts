import assert from "node:assert/strict";
import test from "node:test";
import { resolveResumeTarget } from "./resume-target.js";

const electrician = { service_text: "eletricista", public_code: "CC-23456789" };
const plumber = { service_text: "encanador", public_code: null };
test("resume resolves an owned code or an unambiguous natural service, never another context", () => {
  assert.equal(resolveResumeTarget([electrician, plumber], [electrician.public_code], ""), electrician);
  assert.equal(resolveResumeTarget([electrician, plumber], [], "Eletricista"), electrician);
  assert.equal(resolveResumeTarget([electrician, plumber], [], "encanador"), plumber);
  assert.equal(resolveResumeTarget([electrician], ["CC-ABCDEFGH"], "eletricista"), null);
});
test("ambiguous resume and partial words never switch context", () => {
  assert.equal(resolveResumeTarget([electrician, plumber], [], ""), null);
  assert.equal(resolveResumeTarget([electrician, { ...electrician, public_code: "CC-ABCDEFGH" }], [], "eletricista"), null);
  assert.equal(resolveResumeTarget([electrician], [], "eletric"), null);
  assert.equal(resolveResumeTarget([electrician], [electrician.public_code, "CC-ABCDEFGH"], ""), null);
  assert.equal(resolveResumeTarget([], [], ""), null);
});
