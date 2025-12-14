// Mock for bad-words package to avoid ESM issues in Jest
export class Filter {
  clean(text: string): string {
    // Simple mock implementation - just return the text as-is
    return text;
  }
}
