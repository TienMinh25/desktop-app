export interface McpRegistryIcon {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: string
}

export interface McpRegistryRepository {
  url?: string
  source?: string
  id?: string
  subfolder?: string
}

export interface McpRegistryEnvVar {
  name: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  default?: string
}

export interface McpRegistryPackage {
  registryType?: string
  registryBaseUrl?: string
  identifier?: string
  version?: string
  transport?: {
    type?: string
    url?: string
  }
  environmentVariables?: McpRegistryEnvVar[]
  packageArguments?: Array<{
    name?: string
    description?: string
    type?: string
  }>
}

export interface McpRegistryRemote {
  type?: string
  url?: string
  headers?: Array<{
    name: string
    description?: string
    isRequired?: boolean
    isSecret?: boolean
  }>
}

export interface McpRegistryServerJSON {
  $schema?: string
  name: string
  title?: string
  description?: string
  version?: string
  websiteUrl?: string
  icons?: McpRegistryIcon[]
  repository?: McpRegistryRepository
  packages?: McpRegistryPackage[]
  remotes?: McpRegistryRemote[]
  tools?: Array<string | { name: string; description?: string }>
}

export interface McpRegistryOfficialMeta {
  status?: string
  publishedAt?: string
  updatedAt?: string
  isLatest?: boolean
}

export interface McpRegistryServerEntry {
  server: McpRegistryServerJSON
  _meta?: {
    "io.modelcontextprotocol.registry/official"?: McpRegistryOfficialMeta
    [key: string]: unknown
  }
}

export interface McpRegistryListRawPayload {
  servers?: unknown[]
  metadata?: {
    nextCursor?: string
    next_cursor?: string
    count?: number
  }
}

export interface McpRegistryClientConfig {
  baseUrl?: string
  apiVersion?: string
}
