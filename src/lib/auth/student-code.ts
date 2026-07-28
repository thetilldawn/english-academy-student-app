import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
} from "node:crypto";

import {
  STUDENT_COOKIE_DEVELOPMENT,
  STUDENT_COOKIE_PRODUCTION,
  STUDENT_SESSION_MAX_AGE_SECONDS,
} from "@/lib/constants";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type EncryptedStudentCode = {
  encryptedCode: string;
  encryptionIv: string;
  encryptionTag: string;
};

function decodeKey(value: string): Buffer {
  const key = Buffer.from(value, "base64");

  if (key.length !== 32) {
    throw new Error("암호화 키는 32바이트여야 합니다.");
  }

  return key;
}

export function normalizeStudentCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function formatStudentCode(value: string): string {
  const normalized = normalizeStudentCode(value);
  return normalized.match(/.{1,4}/g)?.join("-") ?? normalized;
}

export function generateStudentCode(): string {
  let code = "";

  for (let index = 0; index < 12; index += 1) {
    code += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }

  return formatStudentCode(code);
}

export function hashStudentCode(code: string, pepperBase64: string): string {
  return createHmac("sha256", decodeKey(pepperBase64))
    .update(normalizeStudentCode(code), "utf8")
    .digest("hex")
    .toUpperCase();
}

export function encryptStudentCode(
  code: string,
  encryptionKeyBase64: string,
): EncryptedStudentCode {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    decodeKey(encryptionKeyBase64),
    iv,
  );
  const encrypted = Buffer.concat([
    cipher.update(formatStudentCode(code), "utf8"),
    cipher.final(),
  ]);

  return {
    encryptedCode: encrypted.toString("base64"),
    encryptionIv: iv.toString("base64"),
    encryptionTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptStudentCode(
  encrypted: EncryptedStudentCode,
  encryptionKeyBase64: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    decodeKey(encryptionKeyBase64),
    Buffer.from(encrypted.encryptionIv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.encryptionTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.encryptedCode, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function generateStudentSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashStudentSessionToken(
  token: string,
  pepperBase64: string,
): string {
  return createHmac("sha256", decodeKey(pepperBase64))
    .update(token, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function hashLoginIp(value: string, pepperBase64: string): string {
  return createHmac("sha256", decodeKey(pepperBase64))
    .update(value, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function getStudentCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? STUDENT_COOKIE_PRODUCTION
    : STUDENT_COOKIE_DEVELOPMENT;
}

export function getStudentCookieOptions() {
  return {
    httpOnly: true,
    maxAge: STUDENT_SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
}
