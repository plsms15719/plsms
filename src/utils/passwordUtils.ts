/**
 * Password Strength and Validation Utility
 * Enforces: Strong password with at least 6 mixing characters (letters, numbers, special symbols)
 */

export interface PasswordValidationResult {
  isValid: boolean;
  score: number; // 0: Invalid, 1: Weak, 2: Moderate, 3: Strong
  message: string;
  checks: {
    minLength: boolean;
    hasLetters: boolean;
    hasNumbers: boolean;
    hasSymbols: boolean;
    isMixed: boolean;
  };
}

export function validatePasswordStrength(pwd: string): PasswordValidationResult {
  const trimmed = pwd || '';
  const minLength = trimmed.length >= 6;
  const hasLetters = /[a-zA-Z]/.test(trimmed);
  const hasNumbers = /[0-9]/.test(trimmed);
  const hasSymbols = /[^a-zA-Z0-9]/.test(trimmed);

  // Mixed requires letters combined with either numbers, symbols, or both
  const isMixed = hasLetters && (hasNumbers || hasSymbols);

  let score = 0;
  if (!minLength) {
    return {
      isValid: false,
      score: 0,
      message: 'Password must be at least 6 characters long.',
      checks: { minLength, hasLetters, hasNumbers, hasSymbols, isMixed },
    };
  }

  if (!isMixed) {
    return {
      isValid: false,
      score: 1,
      message: 'Password must contain mixing characters (letters combined with numbers or symbols).',
      checks: { minLength, hasLetters, hasNumbers, hasSymbols, isMixed },
    };
  }

  // Calculate score (2: Moderate, 3: Strong)
  if (trimmed.length >= 8 && hasLetters && hasNumbers && hasSymbols) {
    score = 3;
  } else if (trimmed.length >= 6 && isMixed) {
    score = trimmed.length >= 8 ? 3 : 2;
  } else {
    score = 1;
  }

  return {
    isValid: true,
    score,
    message: score === 3 ? 'Strong secure password.' : 'Valid mixed password.',
    checks: { minLength, hasLetters, hasNumbers, hasSymbols, isMixed },
  };
}

/**
 * Generates a compliant, strong temporary password with mixed characters.
 */
export function generateStrongPassword(prefix: string = 'PLSMS'): string {
  const specials = ['@', '#', '$', '%', '&'];
  const special = specials[Math.floor(Math.random() * specials.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${special}${num}`;
}
