export function authErrorMessage(code?: string): string {
  if (code === "INVALID_EMAIL_OR_PASSWORD") return "El correo o la contraseña no coinciden. Revisa tus datos o recupera tu acceso.";
  if (code === "USER_ALREADY_EXISTS" || code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") return "No se pudo crear la cuenta. Si ya tienes acceso, inicia sesión o recupera tu contraseña.";
  if (code === "TOO_MANY_REQUESTS") return "Has realizado varios intentos. Espera unos minutos y vuelve a intentarlo.";
  if (code === "INVALID_TOKEN" || code === "TOKEN_EXPIRED") return "El enlace ya no es válido. Solicita uno nuevo para recuperar tu acceso.";
  return "No se pudo completar la solicitud. Conservamos tus datos; vuelve a intentarlo.";
}

export function postLoginPath(callback: string | null): string {
  if (!callback || /[\\\u0000-\u0020]/.test(callback)) return "/dashboard";
  return callback === "/dashboard" || callback.startsWith("/dashboard/") || callback.startsWith("/dashboard?")
    ? callback : "/dashboard";
}
