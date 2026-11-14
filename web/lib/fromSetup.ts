"use client";

import { useEffect, useState } from "react";

/** Link to a customise page that returns to /start when done. */
export const FROM_SETUP = "?from=start";

/** True when the page was opened from the /start setup (`?from=start`). */
export function useFromSetup(): boolean {
  const [from, setFrom] = useState(false);
  useEffect(() => {
    setFrom(new URLSearchParams(window.location.search).get("from") === "start");
  }, []);
  return from;
}
