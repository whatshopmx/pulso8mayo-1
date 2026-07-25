import { hashPassword } from "better-auth/crypto";

async function run() {
  console.log("Hashing '123456'...");
  const hashed = await hashPassword("123456");
  console.log("Hashed password:", hashed);
}

run().catch(console.error);
