import { QueryClient } from "@tanstack/react-query";
import { ServiceError } from "../lib/service-client";

export function createLocalQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: (count, error) => error instanceof ServiceError && error.retryable && count < 1,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
