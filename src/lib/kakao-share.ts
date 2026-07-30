"use client";

type KakaoSdk = {
  init(key: string): void;
  isInitialized(): boolean;
  Share: {
    sendDefault(input: {
      objectType: "text";
      text: string;
      link: { mobileWebUrl: string; webUrl: string };
    }): void;
  };
};

declare global {
  interface Window {
    Kakao?: KakaoSdk;
  }
}

let sdkPromise: Promise<KakaoSdk> | null = null;

function loadKakaoSdk() {
  if (window.Kakao) return Promise.resolve(window.Kakao);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<KakaoSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-english-project-kakao-sdk]",
    );
    const script = existing ?? document.createElement("script");
    const finish = () => {
      if (window.Kakao) resolve(window.Kakao);
      else reject(new Error("Kakao SDK did not initialize."));
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Kakao SDK failed to load.")),
      { once: true },
    );
    if (!existing) {
      script.src =
        "https://t1.kakaocdn.net/kakao_js_sdk/2.8.1/kakao.min.js";
      script.integrity =
        "sha384-OL+ylM/iuPLtW5U3XcvLSGhE8JzReKDank5InqlHGWPhb4140/yrBw0bg0y7+C9J";
      script.crossOrigin = "anonymous";
      script.dataset.englishProjectKakaoSdk = "true";
      document.head.append(script);
    }
  });
  return sdkPromise;
}

export async function sendKakaoText(input: {
  title: string;
  message: string;
  url: string;
}): Promise<"sent" | "unconfigured" | "failed"> {
  const key = process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY?.trim();
  if (!key) return "unconfigured";
  try {
    const kakao = await loadKakaoSdk();
    if (!kakao.isInitialized()) kakao.init(key);
    kakao.Share.sendDefault({
      objectType: "text",
      text: `${input.title}\n${input.message}`,
      link: {
        mobileWebUrl: input.url,
        webUrl: input.url,
      },
    });
    return "sent";
  } catch {
    return "failed";
  }
}
