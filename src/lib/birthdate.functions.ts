import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth/middleware";

export const getBirthdateStatus = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { hasBirthdate } = await import("./birthdate.server");
    return { present: await hasBirthdate(context.userId) };
  });

export const saveMyBirthdate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((data: unknown) => z.object({ birthdate: z.string().max(10) }).strict().parse(data))
  .handler(async ({ data, context }) => {
    const { saveBirthdate } = await import("./birthdate.server");
    await saveBirthdate(context.userId, data.birthdate, "user");
    return { ok: true as const };
  });
