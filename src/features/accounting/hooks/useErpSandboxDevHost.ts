"use client";

import { useEffect, useState } from "react";
import { isErpSandboxHostAllowed } from "@/lib/acc/erp-environment-shared";

/** True only on local dev hosts (localhost:3021). False until mounted. */
export function useErpSandboxDevHost(): boolean {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    setAllowed(isErpSandboxHostAllowed(window.location.host));
  }, []);

  return allowed;
}
