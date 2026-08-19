export async function confirmCloudDelete(confirm: () => Promise<boolean>, invalidate: () => void): Promise<boolean> {
  if (!(await confirm())) return false;
  invalidate();
  return true;
}
