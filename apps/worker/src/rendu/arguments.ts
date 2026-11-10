// Construction PURE des arguments ffmpeg du montage (aucun appel système ici : tout est testable sans ffmpeg).
// Étapes : segment par plan (vidéo seule + audio WAV), concaténation, mixage final avec voix, musique, bruitage et sous-titres.

/** Orientation de la sortie : vertical 9:16 (courts, génériques, bande annonce) ou horizontal 16:9 (film). */
export type Orientation = "vertical" | "horizontal";

/** Dimensions de sortie par orientation. */
export const DIMENSIONS: Record<Orientation, { largeur: number; hauteur: number }> = {
  vertical: { largeur: 1080, hauteur: 1920 },
  horizontal: { largeur: 1920, hauteur: 1080 },
};

/** Images par seconde de toutes les sorties. */
export const IPS = 30;
/** Fréquence d'échantillonnage de tous les sons. */
export const FREQ_AUDIO = 48000;

/** Volumes du mixage. Dans un clip musical, le son des clips Grok est coupé : seule la chanson s'entend. */
export const VOLUMES = { clipsAvecVoix: 0.35, clipsSansVoix: 1, clipsMusicaux: 0, musique: 0.15, bruitage: 0.25, chanson: 1 } as const;

/** Durée du fondu de fin de la chanson d'un clip (secondes). */
export const FONDU_CHANSON = 1.5;

/** Extrait de chanson placé sous un clip musical : fichier, début dans le fichier et durée. */
export type ChansonPlacee = { chemin: string; debut: number; duree: number };

/** Arguments communs : pas de bannière, peu de bruit, jamais d'attente au clavier, écrasement autorisé. */
const DEBUT = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];

/** Encodage vidéo intermédiaire (segments) : un peu plus fin que la sortie, car il sera réencodé une fois. */
const VIDEO_INTERMEDIAIRE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p"];

/** Encodage final demandé : H.264 veryfast CRF 20, yuv420p, AAC 160 kb/s, lecture rapide sur le web. */
export const ENCODAGE_FINAL = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", String(FREQ_AUDIO), "-ac", "2", "-movflags", "+faststart"];

/** Arrondit une durée en secondes à la milliseconde (évite les « 4.999999999 » dans les arguments). */
export function sec(x: number): string {
  return String(Math.round(x * 1000) / 1000);
}

/**
 * Échappe une valeur placée dans un filtre de `-filter_complex`.
 * Deux niveaux (doc ffmpeg « Notes on filtergraph escaping ») :
 * 1. valeur d'option : `\`, `'` et `:` sont précédés d'une barre oblique inverse ;
 * 2. description du graphe : `\`, `'`, `[`, `]`, `,` et `;` le sont à nouveau.
 * Aucun troisième niveau : les arguments sont passés à spawn sans shell.
 */
export function echapperValeurFiltre(valeur: string): string {
  const niveau1 = valeur.replace(/[\\':]/g, (c) => `\\${c}`);
  return niveau1.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/** Style des sous-titres selon l'orientation : taille et marge en pixels de la vidéo (PlayRes = dimensions réelles). */
export function styleSousTitres(police: string, orientation: Orientation): string {
  const { largeur, hauteur } = DIMENSIONS[orientation];
  // En vertical, on remonte le texte au-dessus des boutons et de la légende de TikTok / Instagram.
  const taille = 56;
  const marge = orientation === "vertical" ? 380 : 70;
  return [`PlayResX=${largeur}`, `PlayResY=${hauteur}`, `FontName=${police}`, `FontSize=${taille}`, "PrimaryColour=&H00FFFFFF", "OutlineColour=&H00000000", "BorderStyle=1", "Outline=2", "Shadow=0", `MarginV=${marge}`, "Alignment=2"].join(",");
}

/** Filtre `subtitles` complet, avec le chemin du fichier SRT et le style correctement échappés. */
export function filtreSousTitres(cheminSrt: string, police: string, orientation: Orientation): string {
  return `subtitles=filename=${echapperValeurFiltre(cheminSrt)}:force_style=${echapperValeurFiltre(styleSousTitres(police, orientation))}`;
}

/**
 * Chaîne de filtres vidéo d'un segment : mise à l'échelle et bandes noires (ou recadrage au centre en 9:16),
 * 30 i/s, pixels carrés, puis durée exacte (la dernière image est prolongée si le clip est trop court).
 */
export function filtreVideoSegment(p: { orientation: Orientation; duree: number; recadrer?: boolean }): string {
  const { largeur: l, hauteur: h } = DIMENSIONS[p.orientation];
  const cadre = p.recadrer
    ? `crop=ih*9/16:ih,scale=${l}:${h}`
    : `scale=${l}:${h}:force_original_aspect_ratio=decrease,pad=${l}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`;
  return `${cadre},setsar=1,fps=${IPS},tpad=stop_mode=clone:stop_duration=${sec(p.duree)},trim=duration=${sec(p.duree)},setpts=PTS-STARTPTS,format=yuv420p`;
}

/** Paramètres d'un segment. */
export type ParamsSegment = {
  entree: string;
  sortieVideo: string;
  sortieAudio: string;
  duree: number;
  orientation: Orientation;
  /** Vrai si l'entrée a une piste audio (sinon on fabrique un silence avec anullsrc). */
  aAudio: boolean;
  /** Volume appliqué à l'audio du clip. */
  volume: number;
  /** Recadrage au centre en 9:16 (bande annonce tirée d'un film). */
  recadrer?: boolean;
};

/**
 * Un segment par plan : vidéo seule (MP4) et audio PCM (WAV) de durée exacte.
 * Séparer l'audio en PCM évite le décalage que l'AAC accumulerait d'un segment à l'autre lors de la concaténation.
 */
export function argumentsSegment(p: ParamsSegment): string[] {
  const d = sec(p.duree);
  const entreeAudio = p.aAudio ? "[0:a]" : "[1:a]";
  const filtre = [
    `[0:v]${filtreVideoSegment(p)}[v]`,
    `${entreeAudio}aresample=${FREQ_AUDIO},aformat=sample_fmts=s16:sample_rates=${FREQ_AUDIO}:channel_layouts=stereo,volume=${p.volume},apad,atrim=0:${d},asetpts=N/SR/TB[a]`,
  ].join(";");
  return [
    ...DEBUT,
    "-i",
    p.entree,
    ...(p.aAudio ? [] : ["-f", "lavfi", "-i", `anullsrc=r=${FREQ_AUDIO}:cl=stereo`]),
    "-filter_complex",
    filtre,
    "-map",
    "[v]",
    "-an",
    ...VIDEO_INTERMEDIAIRE,
    "-r",
    String(IPS),
    "-t",
    d,
    p.sortieVideo,
    "-map",
    "[a]",
    "-vn",
    "-c:a",
    "pcm_s16le",
    "-ar",
    String(FREQ_AUDIO),
    "-ac",
    "2",
    "-t",
    d,
    p.sortieAudio,
  ];
}

/** Contenu d'une liste pour le démultiplexeur concat (apostrophes échappées selon sa syntaxe). */
export function listeConcat(chemins: readonly string[]): string {
  return `ffconcat version 1.0\n${chemins.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n")}\n`;
}

/** Concaténation sans réencodage (`-f concat -safe 0`) : tous les segments ont exactement les mêmes paramètres. */
export function argumentsConcat(fichierListe: string, sortie: string): string[] {
  return [...DEBUT, "-f", "concat", "-safe", "0", "-i", fichierListe, "-c", "copy", sortie];
}

/** Une voix à placer dans le mixage : au début de son plan, coupée à la durée du plan. */
export type VoixPlacee = { chemin: string; debut: number; duree: number };

/** Paramètres du mixage final. */
export type ParamsFinal = {
  video: string;
  audio: string;
  voix: readonly VoixPlacee[];
  musique: string | null;
  bruitage: string | null;
  /** Fichier SRT à incruster (null : pas de sous-titres). */
  sousTitres: string | null;
  police: string;
  orientation: Orientation;
  dureeTotale: number;
  sortie: string;
  /** Clip musical : l'extrait de la chanson, lu à partir de son début, avec un fondu de fin. */
  chanson?: ChansonPlacee | null;
};

/**
 * Mixage et encodage final : audio des segments + voix (adelay) + musique et bruitage en boucle,
 * sous-titres incrustés si demandés, sortie H.264/AAC.
 */
export function argumentsFinal(p: ParamsFinal): string[] {
  const total = sec(p.dureeTotale);
  const entrees: string[] = ["-i", p.video, "-i", p.audio];
  const filtres: string[] = [`[1:a]aformat=sample_fmts=fltp:sample_rates=${FREQ_AUDIO}:channel_layouts=stereo[base]`];
  const pistes: string[] = ["[base]"];
  let n = 2;
  p.voix.forEach((v, i) => {
    entrees.push("-i", v.chemin);
    const ms = Math.max(0, Math.round(v.debut * 1000));
    filtres.push(`[${n}:a]aresample=${FREQ_AUDIO},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=0:${sec(v.duree)},adelay=${ms}:all=1[voix${i}]`);
    pistes.push(`[voix${i}]`);
    n++;
  });
  const fond = (chemin: string | null, nom: string, volume: number): void => {
    if (!chemin) return;
    // -stream_loop -1 : la musique ou l'ambiance tourne en boucle sur toute la durée.
    entrees.push("-stream_loop", "-1", "-i", chemin);
    filtres.push(`[${n}:a]aresample=${FREQ_AUDIO},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${volume},atrim=0:${total}[${nom}]`);
    pistes.push(`[${nom}]`);
    n++;
  };
  fond(p.musique, "musique", VOLUMES.musique);
  fond(p.bruitage, "bruitage", VOLUMES.bruitage);
  if (p.chanson) {
    // -ss avant -i : lecture rapide à partir du début de l'extrait ; -t borne la lecture à sa durée.
    entrees.push("-ss", sec(p.chanson.debut), "-t", sec(p.chanson.duree), "-i", p.chanson.chemin);
    const fondu = Math.min(FONDU_CHANSON, p.chanson.duree / 4);
    filtres.push(
      `[${n}:a]aresample=${FREQ_AUDIO},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${VOLUMES.chanson},apad,atrim=0:${total},afade=t=in:d=0.05,afade=t=out:st=${sec(Math.max(0, p.dureeTotale - fondu))}:d=${sec(fondu)}[chanson]`,
    );
    pistes.push("[chanson]");
    n++;
  }
  // normalize=0 : amix ne divise pas les volumes par le nombre d'entrées ; alimiter évite la saturation.
  filtres.push(
    pistes.length > 1
      ? `${pistes.join("")}amix=inputs=${pistes.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[a]`
      : `[base]alimiter=limit=0.95[a]`,
  );
  filtres.push(p.sousTitres ? `[0:v]${filtreSousTitres(p.sousTitres, p.police, p.orientation)}[v]` : `[0:v]null[v]`);
  return [...DEBUT, ...entrees, "-filter_complex", filtres.join(";"), "-map", "[v]", "-map", "[a]", ...ENCODAGE_FINAL, "-r", String(IPS), "-t", total, p.sortie];
}

/** Arguments ffprobe pour lire durée, dimensions et pistes d'un fichier en JSON. */
export function argumentsSonde(fichier: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", fichier];
}
