"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login, type LoginState } from "@/lib/actions/auth";

export default function LoginPage() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<LoginState, FormData>(
    login,
    {},
  );

  useEffect(() => {
    if (state.ok) router.replace("/");
  }, [state, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          Marketing Expense Tracker
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          JSW marketing team — enter the shared password to continue.
        </p>

        <label htmlFor="password" className="mt-6 block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoFocus
          autoComplete="current-password"
          className="mt-1.5 block h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
        />

        {state.error ? (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white transition-opacity hover:bg-neutral-800 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
