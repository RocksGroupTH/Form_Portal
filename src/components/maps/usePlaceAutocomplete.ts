"use client";

import { useCallback, useRef, useState } from "react";
import { BANGKOK_CENTER } from "@/lib/google-maps-constants";

/**
 * Google Places autocomplete, debounced, with a session token.
 *
 * Extracted from `GoogleRoutePicker` on 2026-09-01 so AP-17's place fields use
 * the same one rather than a second copy. Nothing about the behaviour changed
 * in the move.
 *
 * ── The session token is a billing decision, not bookkeeping ──
 *
 * Google bills autocomplete per *session* when keystrokes are grouped under one
 * token, and per *request* when they are not. `resetToken()` must be called when
 * a suggestion is taken — that ends the session — and the next keystroke starts
 * a new one. Dropping the token would multiply the bill by however many
 * characters somebody types.
 *
 * ── Browser-only, and that is forced ──
 *
 * The Google key this app holds is HTTP-referrer restricted: measured
 * 2026-09-01, a server-side Places call answers 403
 * `API_KEY_HTTP_REFERRER_BLOCKED` and Geocoding answers "API keys with referer
 * restrictions cannot be used with this API". So there is no server route to
 * put this behind, and the referrer restriction is what protects the key that
 * is already public by design.
 */
export function usePlaceAutocomplete(
  isLoaded: boolean,
  options?: {
    /**
     * Narrow what Google returns — `["(cities)"]` for a city picker.
     * Omitted, every kind of place is offered.
     */
    includedPrimaryTypes?: string[];
    /**
     * ISO-3166-1 alpha-2, lower-cased by this hook. Restricts results to that
     * country.
     *
     * A **restriction**, not the Bangkok bias below — the trip's country is a
     * deliberate answer on the form above, so a search for "central" on a UK
     * trip should not offer Central World in Bangkok. Omitted, the world is
     * searched with the bias only.
     */
    regionCode?: string | null;
  },
) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typesRef = useRef(options?.includedPrimaryTypes);
  typesRef.current = options?.includedPrimaryTypes;
  const regionRef = useRef(options?.regionCode);
  regionRef.current = options?.regionCode;

  const search = useCallback(
    async (input: string) => {
      if (!isLoaded || input.trim().length < 2) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new google.maps.places.AutocompleteSessionToken();
        }
        const req: google.maps.places.AutocompleteRequest = {
          input,
          sessionToken: sessionTokenRef.current,
          // Ranking, not filtering — and it composes with the region
          // restriction below rather than fighting it: inside the trip's own
          // country, nearer-to-Bangkok still ranks first, which is right for a
          // Thai trip and irrelevant for a foreign one.
          locationBias: { lat: BANGKOK_CENTER.lat, lng: BANGKOK_CENTER.lng, radius: 200000 },
        };
        if (typesRef.current?.length) req.includedPrimaryTypes = typesRef.current;
        const region = (regionRef.current ?? "").trim().toLowerCase();
        if (/^[a-z]{2}$/.test(region)) req.includedRegionCodes = [region];
        const response =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
        setSuggestions(response.suggestions || []);
        setShowDropdown(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    },
    [isLoaded],
  );

  const handleInputChange = useCallback(
    (text: string) => {
      setQuery(text);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (text.trim().length < 2) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      timerRef.current = setTimeout(() => search(text), 300);
    },
    [search],
  );

  /** Ends the billing session. Call it when a suggestion is taken. */
  const resetToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  return {
    query,
    setQuery,
    suggestions,
    showDropdown,
    setShowDropdown,
    handleInputChange,
    resetToken,
    loading,
  };
}
