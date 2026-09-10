export function guatemalaLocalPhoneDigits(input: string) {
  const digits = input.replace(/\D/g, "");
  const localDigits = digits.startsWith("502") ? digits.slice(3) : digits;
  return localDigits.slice(0, 8);
}
