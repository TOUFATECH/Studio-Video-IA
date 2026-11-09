// Tests des constructeurs d'arguments ffmpeg (sans lancer ffmpeg) et de l'échappement du chemin des sous-titres.
import { describe, expect, it } from "vitest";
import {
  argumentsConcat,
  argumentsFinal,
  argumentsSegment,
  echapperValeurFiltre,
  filtreSousTitres,
  filtreVideoSegment,
  listeConcat,
  sec,
  styleSousTitres,
} from "../src/rendu/arguments";

/** Valeur qui suit une option dans une liste d'arguments. */
function apres(args: readonly string[], option: string, rang = 0): string | undefined {
  let vu = -1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === option && ++vu === rang) return args[i + 1];
  }
  return undefined;
}

describe("segments", () => {
  it("met à l'échelle avec bandes noires en 1080x1920, 30 i/s, pixels carrés, durée exacte", () => {
    const f = filtreVideoSegment({ orientation: "vertical", duree: 5 });
    expect(f).toContain("scale=1080:1920:force_original_aspect_ratio=decrease");
    expect(f).toContain("pad=1080:1920:(ow-iw)/2:(oh-ih)/2");
    expect(f).toContain("setsar=1");
    expect(f).toContain("fps=30");
    expect(f).toContain("tpad=stop_mode=clone:stop_duration=5");
    expect(f).toContain("trim=duration=5");
  });
  it("film : 1920x1080", () => {
    expect(filtreVideoSegment({ orientation: "horizontal", duree: 8 })).toContain("scale=1920:1080");
  });
  it("bande annonce : recadrage au centre en 9:16", () => {
    expect(filtreVideoSegment({ orientation: "vertical", duree: 5, recadrer: true })).toMatch(/^crop=ih\*9\/16:ih,scale=1080:1920,/);
  });
  it("clip avec audio : pas d'anullsrc, volume appliqué, deux sorties", () => {
    const a = argumentsSegment({ entree: "/c.mp4", sortieVideo: "/v.mp4", sortieAudio: "/a.wav", duree: 3, orientation: "vertical", aAudio: true, volume: 0.35 });
    expect(a.join(" ")).not.toContain("anullsrc");
    const filtre = apres(a, "-filter_complex") ?? "";
    expect(filtre).toContain("[0:a]aresample=48000");
    expect(filtre).toContain("volume=0.35");
    expect(filtre).toContain("atrim=0:3");
    expect(a).toContain("/v.mp4");
    expect(a.at(-1)).toBe("/a.wav");
    expect(apres(a, "-c:a")).toBe("pcm_s16le");
    expect(apres(a, "-t")).toBe("3");
  });
  it("clip sans audio : piste de silence anullsrc garantie", () => {
    const a = argumentsSegment({ entree: "/c.mp4", sortieVideo: "/v.mp4", sortieAudio: "/a.wav", duree: 2.5, orientation: "vertical", aAudio: false, volume: 1 });
    expect(a).toContain("lavfi");
    expect(apres(a, "-i", 1)).toBe("anullsrc=r=48000:cl=stereo");
    expect(apres(a, "-filter_complex")).toContain("[1:a]aresample");
  });
  it("arrondit les durées", () => {
    expect(sec(4.9999999)).toBe("5");
    expect(sec(1.23456)).toBe("1.235");
  });
});

describe("concaténation", () => {
  it("utilise -f concat -safe 0 et copie les flux", () => {
    expect(argumentsConcat("/l.txt", "/o.mp4")).toEqual(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-f", "concat", "-safe", "0", "-i", "/l.txt", "-c", "copy", "/o.mp4"]);
  });
  it("échappe les apostrophes dans la liste", () => {
    expect(listeConcat(["/tmp/a.mp4", "/tmp/l'essai/b.mp4"])).toBe("ffconcat version 1.0\nfile '/tmp/a.mp4'\nfile '/tmp/l'\\''essai/b.mp4'\n");
  });
});

describe("échappement du chemin des sous-titres", () => {
  it("chemin simple inchangé", () => {
    expect(echapperValeurFiltre("/tmp/rendu/st.srt")).toBe("/tmp/rendu/st.srt");
  });
  it("deux-points (Windows) : « \\: » au premier niveau, barre doublée au second", () => {
    expect(echapperValeurFiltre("C:/rendu/st.srt")).toBe("C\\\\:/rendu/st.srt");
  });
  it("apostrophe, virgule, crochets et point-virgule", () => {
    expect(echapperValeurFiltre("/a'b")).toBe("/a\\\\\\'b");
    expect(echapperValeurFiltre("/a,b;c[d]")).toBe("/a\\,b\\;c\\[d\\]");
  });
  it("barre oblique inverse doublée deux fois", () => {
    expect(echapperValeurFiltre("a\\b")).toBe("a\\\\\\\\b");
  });
  it("filtre complet avec style", () => {
    const f = filtreSousTitres("/tmp/x/st.srt", "Noto Sans CJK JP", "vertical");
    expect(f.startsWith("subtitles=filename=/tmp/x/st.srt:force_style=")).toBe(true);
    // Les virgules du style sont échappées pour ne pas couper la chaîne de filtres.
    expect(f).toContain("FontName=Noto Sans CJK JP\\,");
    expect(f).toContain("Outline=2");
    expect(styleSousTitres("Police", "horizontal")).toContain("PlayResX=1920,PlayResY=1080");
  });
});

describe("mixage final", () => {
  const base = { video: "/v.mp4", audio: "/a.wav", police: "Noto Sans CJK JP", orientation: "vertical" as const, dureeTotale: 75, sortie: "/s.mp4" };

  it("sans voix ni musique ni sous-titres", () => {
    const a = argumentsFinal({ ...base, voix: [], musique: null, bruitage: null, sousTitres: null });
    const filtre = apres(a, "-filter_complex") ?? "";
    expect(filtre).toContain("[base]alimiter=limit=0.95[a]");
    expect(filtre).toContain("[0:v]null[v]");
    expect(a).not.toContain("-stream_loop");
  });

  it("voix placées avec adelay, musique et bruitage en boucle, sous-titres, encodage demandé", () => {
    const a = argumentsFinal({
      ...base,
      voix: [
        { chemin: "/v1.mp3", debut: 3.15, duree: 7.85 },
        { chemin: "/v2.mp3", debut: 20, duree: 5 },
      ],
      musique: "/m.mp3",
      bruitage: "/b.mp3",
      sousTitres: "/st.srt",
    });
    const filtre = apres(a, "-filter_complex") ?? "";
    expect(filtre).toContain("[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:7.85,adelay=3150:all=1[voix0]");
    expect(filtre).toContain("adelay=20000:all=1[voix1]");
    expect(filtre).toContain("[4:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.15,atrim=0:75[musique]");
    expect(filtre).toContain("volume=0.25,atrim=0:75[bruitage]");
    expect(filtre).toContain("[base][voix0][voix1][musique][bruitage]amix=inputs=5:duration=first:dropout_transition=0:normalize=0");
    expect(filtre).toContain("[0:v]subtitles=filename=/st.srt:force_style=");
    expect(a.filter((x) => x === "-stream_loop")).toHaveLength(2);
    expect(apres(a, "-preset")).toBe("veryfast");
    expect(apres(a, "-crf")).toBe("20");
    expect(apres(a, "-pix_fmt")).toBe("yuv420p");
    expect(apres(a, "-c:a")).toBe("aac");
    expect(apres(a, "-b:a")).toBe("160k");
    expect(apres(a, "-movflags")).toBe("+faststart");
    expect(a.at(-1)).toBe("/s.mp4");
  });
});
