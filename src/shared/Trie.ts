export class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEnd: boolean = false;
  value: string | null = null;
}

export class Trie {
  private root: TrieNode = new TrieNode();

  insert(word: string): void {
    const lower = word.toLowerCase();
    let node = this.root;
    for (const char of lower) {
      let child = node.children.get(char);
      if (!child) {
        child = new TrieNode();
        node.children.set(char, child);
      }
      node = child;
    }
    node.isEnd = true;
    node.value = word;
  }

  hasPrefix(prefix: string): boolean {
    const lower = prefix.toLowerCase();
    let node = this.root;
    for (const char of lower) {
      const child = node.children.get(char);
      if (!child) return false;
      node = child;
    }
    return true;
  }

  search(prefix: string): string[] {
    const lower = prefix.toLowerCase();
    let node = this.root;
    for (const char of lower) {
      const child = node.children.get(char);
      if (!child) return [];
      node = child;
    }
    const results: string[] = [];
    this.collectAll(node, results);
    return results;
  }

  private collectAll(node: TrieNode, results: string[]): void {
    const stack: TrieNode[] = [node];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current.isEnd && current.value !== null) {
        results.push(current.value);
      }
      for (const child of current.children.values()) {
        stack.push(child);
      }
    }
  }

  clear(): void {
    this.root = new TrieNode();
  }
}