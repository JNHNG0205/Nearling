// Ready-to-connect MCP servers for web /mcp. Each was checked on 2026-11-14 to answer
// `tools/list` over Streamable HTTP with no sign-in. `try` is a message to send the pet afterwards.
export interface CatalogEntry {
  id: string;
  name: string;
  url: string;
  what: string;
  try: string;
}

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp",
    what: "Answers questions about any public GitHub project.",
    try: "Use DeepWiki: what is the near/near-api-js repo for?",
  },
  {
    id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp",
    what: "Up-to-date docs and code examples for popular libraries.",
    try: "Find the React docs on the useEffect hook.",
  },
  {
    id: "gitmcp", name: "GitMCP", url: "https://gitmcp.io/docs",
    what: "Reads and searches the docs and code of GitHub projects.",
    try: "Search the docs of vercel/next.js for how routing works.",
  },
  {
    id: "huggingface", name: "Hugging Face", url: "https://huggingface.co/mcp",
    what: "Finds AI models and datasets on the Hugging Face Hub.",
    try: "Find small text-to-speech models on Hugging Face.",
  },
  {
    id: "mslearn", name: "Microsoft Learn", url: "https://learn.microsoft.com/api/mcp",
    what: "Searches Microsoft's official docs and code samples.",
    try: "How do I create a list in Python? Check Microsoft Learn.",
  },
  {
    id: "aws", name: "AWS Knowledge", url: "https://knowledge-mcp.global.api.aws",
    what: "Searches AWS documentation and region availability.",
    try: "Which AWS regions have Amazon Bedrock?",
  },
  {
    id: "cloudflare", name: "Cloudflare Docs", url: "https://docs.mcp.cloudflare.com/mcp",
    what: "Searches Cloudflare's developer documentation.",
    try: "How do Cloudflare Workers handle cron triggers?",
  },
];
