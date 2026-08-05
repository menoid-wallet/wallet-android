/**
 * fonts.ts — loads the two brand faces (Fredoka = rounded display,
 * Plus Jakarta Sans = body).
 *
 * ONLY the weights referenced by FONT in tokens.ts are loaded. Every extra face
 * is a file read + parse on the critical path before the first frame can be
 * painted, and the template was pulling in three faces nothing ever used.
 */
import {
  useFonts,
  Fredoka_500Medium,
  Fredoka_600SemiBold,
  Fredoka_700Bold,
} from "@expo-google-fonts/fredoka";
import {
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
} from "@expo-google-fonts/plus-jakarta-sans";

export function useAppFonts() {
  const [loaded] = useFonts({
    Fredoka_500Medium,
    Fredoka_600SemiBold,
    Fredoka_700Bold,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
  });
  return loaded;
}
