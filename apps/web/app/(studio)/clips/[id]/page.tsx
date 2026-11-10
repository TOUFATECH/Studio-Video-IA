// Page d'un clip : la même page que celle d'un épisode, qui adapte ses étapes au genre « clip ».
import type { Metadata } from "next";
import PageEpisode from "../../episodes/[id]/page";

export const metadata: Metadata = { title: "Clip" };

export default PageEpisode;
