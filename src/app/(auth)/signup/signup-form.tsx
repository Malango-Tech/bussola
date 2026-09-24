"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_PASSWORD_LENGTH = 8;

export function SignupForm({
  selfHosted,
  next,
}: {
  selfHosted: boolean;
  /** Where to land after signing up. Already validated as a same-site path. */
  next?: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [awaitingVerification, setAwaitingVerification] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    const { data, error: signUpError } = await signUp.email({
      name: name.trim(),
      email,
      password,
      // Where the verification link lands, when verification is on.
      callbackURL: next || "/dashboards",
    });
    setLoading(false);

    if (signUpError) {
      setError(signUpError.message || "Could not create the account");
      return;
    }

    // No session means the address has to be confirmed first.
    if (!data?.token) {
      setAwaitingVerification(true);
      return;
    }

    router.push(next || "/dashboards");
    router.refresh();
  }

  if (awaitingVerification) {
    return (
      <div className="space-y-2 text-center" role="status">
        <h2 className="text-lg font-semibold tracking-tight">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to{" "}
          <span className="text-foreground">{email}</span>. Open it to finish
          creating your account.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading
          ? "Creating account…"
          : selfHosted
            ? "Claim this instance"
            : "Create account"}
      </Button>
      {!selfHosted ? (
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline">
            Sign in
          </Link>
        </p>
      ) : null}
    </form>
  );
}
