// Returns the labels written as @label in content. Case-insensitive; the label must stand
// alone, so "@Claudette" and "sam@claude.dev" do not mention "Claude".
export function findMentionedLabels(content: string, labels: string[]): string[] {
  const text = content.toLowerCase()
  return labels.filter((label) => {
    const needle = '@' + label.toLowerCase()
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
      const before = text[i - 1]
      const after = text[i + needle.length]
      if ((before === undefined || !/[\w@]/.test(before)) && (after === undefined || !/[\w-]/.test(after))) return true
    }
    return false
  })
}
