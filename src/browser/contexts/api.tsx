import { createContext, useContext, type ReactNode } from "react";
import { createApiClient, type ApiClient } from "@/api/client";

// ============================================================================
// Context
// ============================================================================

const APIContext = createContext<ApiClient | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface APIProviderProps {
  children: ReactNode;
  baseUrl?: string;
}

export function APIProvider({ children, baseUrl }: APIProviderProps) {
  const client = createApiClient(baseUrl);
  
  return (
    <APIContext.Provider value={client}>
      {children}
    </APIContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useAPI(): ApiClient {
  const client = useContext(APIContext);
  if (!client) {
    throw new Error("useAPI must be used within an APIProvider");
  }
  return client;
}


