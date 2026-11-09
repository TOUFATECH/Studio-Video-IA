"use client";
// Retient le dernier épisode ouvert (cookie lu par le menu latéral pour la carte « Épisode ouvert »).
import { useEffect } from "react";

/** Écrit le cookie « episode_ouvert » au chargement de la page. */
export function MemoriserEpisode({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = `episode_ouvert=${encodeURIComponent(id)}; Max-Age=${60 * 60 * 24 * 30}; path=/; SameSite=Lax`;
  }, [id]);
  return null;
}
