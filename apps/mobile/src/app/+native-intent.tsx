/**
 * Enlaces del sistema. Los archivos compartidos desde otra app no navegan a ninguna parte: los
 * recibe ShareIntake en segundo plano y la app sigue mostrando el disfraz.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (!path || path.includes("dataUrl=")) return "/";
  return path;
}
