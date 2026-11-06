import {
  TeamEmailInput,
  TeamSignInInput,
  TeamSignUpInput,
  type TeamAuthResult,
} from "@t3tools/contracts";
import { forgotPassword, resendVerification, signIn, signOut, signUp } from "./accounts.ts";
import { decodeBody, noContent, ok, requireAuth, type Route } from "./http.ts";

export const authRoutes: ReadonlyArray<Route> = [
  {
    method: "POST",
    path: "/v1/auth/signup",
    async handle(req) {
      const result: TeamAuthResult = await signUp(
        req.ctx,
        decodeBody(TeamSignUpInput, req.body),
        req.ip,
      );
      return ok(result);
    },
  },
  {
    method: "POST",
    path: "/v1/auth/login",
    async handle(req) {
      const result: TeamAuthResult = await signIn(
        req.ctx,
        decodeBody(TeamSignInInput, req.body),
        req.ip,
      );
      return ok(result);
    },
  },
  {
    method: "POST",
    path: "/v1/auth/logout",
    async handle(req) {
      await signOut(req.ctx, await requireAuth(req));
      return noContent;
    },
  },
  {
    method: "POST",
    path: "/v1/auth/resend-verification",
    async handle(req) {
      return ok(await resendVerification(req.ctx, await requireAuth(req), req.ip));
    },
  },
  {
    method: "POST",
    path: "/v1/auth/forgot-password",
    async handle(req) {
      return ok(await forgotPassword(req.ctx, decodeBody(TeamEmailInput, req.body), req.ip));
    },
  },
];
