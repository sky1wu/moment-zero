import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const host =
    incomingHeaders.get("x-forwarded-host") ??
    incomingHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    incomingHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og-v2.png`;

  return {
    title: "零矩协议｜浮空回收平衡挑战",
    description:
      "使用不同升力与挂载倍率的回收气球，让二维力矩归零。每道随机任务均经过精确求解器验证。",
    applicationName: "零矩协议",
    openGraph: {
      title: "零矩协议｜浮空回收平衡挑战",
      description: "配置回收气球，让升力中心精准归零。",
      type: "website",
      locale: "zh_CN",
      images: [
        {
          url: socialImage,
          width: 1680,
          height: 945,
          alt: "零矩协议浮空回收平衡挑战",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "零矩协议｜浮空回收平衡挑战",
      description: "配置回收气球，让升力中心精准归零。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
