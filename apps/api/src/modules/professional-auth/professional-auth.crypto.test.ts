import assert from "node:assert/strict";
import test from "node:test";
import { decryptAuthMessage,encryptAuthMessage,generateOtp,generateSessionToken,hashOtp,hashSessionToken,otpMatches } from "./professional-auth.crypto.js";

test("OTP uses the six digit contract and peppered challenge-bound hashes",()=>{for(let i=0;i<200;i++)assert.match(generateOtp(),/^\d{6}$/u);const first=hashOtp("pepper","11111111-1111-4111-8111-111111111111","123456");const other=hashOtp("pepper","22222222-2222-4222-8222-222222222222","123456");assert.notEqual(first,other);assert.ok(otpMatches(first,hashOtp("pepper","11111111-1111-4111-8111-111111111111","123456")));assert.equal(otpMatches(first,hashOtp("pepper","11111111-1111-4111-8111-111111111111","654321")),false);});
test("session token has at least 256 random bits and only its hash is stable",()=>{const token=generateSessionToken();assert.ok(Buffer.from(token,"base64url").length>=32);assert.equal(hashSessionToken(token).length,64);assert.notEqual(generateSessionToken(),token);});
test("authentication outbox content is encrypted at rest and authenticated",()=>{const plain="Seu código é 123456";const encrypted=encryptAuthMessage("pepper",plain);assert.equal(encrypted.includes("123456"),false);assert.equal(decryptAuthMessage("pepper",encrypted),plain);assert.throws(()=>decryptAuthMessage("other",encrypted));});
