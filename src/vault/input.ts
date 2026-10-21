import { BadRequestException } from "@nestjs/common";

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("JSON 객체가 필요합니다.");
  return value as Record<string, unknown>;
}

export function text(
  value: unknown,
  label: string,
  maximum = 1000,
  optional = false,
): string {
  if (optional && (value === undefined || value === "")) return "";
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new BadRequestException(`${label}: 1~${maximum}자로 입력하세요.`);
  return value.trim();
}

export function strings(
  value: unknown,
  label: string,
  maximum = 100,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 200,
    )
  )
    throw new BadRequestException(`${label}: 문자열 목록이 필요합니다.`);
  return [...new Set(value.map((item) => (item as string).trim()))];
}

export function httpsUrl(value: unknown, label: string): string {
  const raw = text(value, label, 2000);
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      throw new Error();
    return url.toString();
  } catch {
    throw new BadRequestException(`${label}: HTTPS URL을 입력하세요.`);
  }
}
