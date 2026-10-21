import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { BadRequestException } from "@nestjs/common";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import fs from "node:fs/promises";

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(network, prefix, "ipv4");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fc00::", 7, "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("::ffff:0:0", 96, "ipv6");

export function assetUrl(urlValue: string) {
  const url = new URL(urlValue);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname) ||
    !url.hostname.includes(".")
  )
    throw new BadRequestException("공개 HTTPS 자산 URL이 필요합니다.");
  // Only provider CDNs are accepted; arbitrary user hosts must never be fetched.
  const allowed = [
    "upload.wikimedia.org",
    "images.pexels.com",
    "videos.pexels.com",
    "v3b.fal.media",
    "v3.fal.media",
    "v2.fal.media",
    "storage.googleapis.com",
  ];
  if (!allowed.includes(url.hostname))
    throw new BadRequestException(
      "지원하는 자산 호스트: Wikimedia, Pexels, fal, Google Storage. 다른 자료는 허용된 저장소에 올린 뒤 연결하세요.",
    );
  return url;
}

export async function downloadAsset(
  urlValue: string,
  output: string,
  kind: string,
) {
  const url = assetUrl(urlValue);
  const addresses = await lookup(url.hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) =>
      blocked.check(item.address, item.family === 6 ? "ipv6" : "ipv4"),
    )
  )
    throw new BadRequestException("사설 네트워크 주소는 사용할 수 없습니다.");
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  const type = response.headers.get("content-type") || "";
  if (
    !response.ok ||
    !response.body ||
    !type.startsWith(
      kind === "image" ? "image/" : kind === "audio" ? "audio/" : "video/",
    )
  )
    throw new BadRequestException(
      "자산을 내려받지 못했거나 파일 유형이 다릅니다.",
    );
  const limit = kind === "image" ? 25000000 : 200000000;
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new Error("자산 크기 상한 초과") : null, chunk);
    },
  });
  const temporary = `${output}.part`;
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      limiter,
      createWriteStream(temporary),
    );
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
