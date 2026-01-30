export type ModManagerProvider = 'curseforge' | 'modrinth' | (string & {});

export type ModManagerInstallTarget = 'mods' | 'datapacks' | 'modpacks';

export interface ModManagerSearchParams {
  query: string;
  page?: number;
  pageSize?: number;
  sort?: 'relevance' | 'downloads' | 'updated' | 'newest';
  gameVersion?: string;
  loader?: string;
  category?: string;
}

export interface ModManagerSearchResultItem {
  id: string;
  provider: ModManagerProvider;
  name: string;
  slug?: string;
  summary?: string;
  iconUrl?: string;
  author?: string;
  downloads?: number;
  updatedAt?: string;
  latestVersion?: string;
  gameVersions?: string[];
  loaders?: string[];
  categories?: string[];
}

export interface ModManagerSearchResponse {
  items: ModManagerSearchResultItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

export interface ModManagerProjectDetail {
  id: string;
  provider: ModManagerProvider;
  name: string;
  slug?: string;
  summary?: string;
  description?: string;
  iconUrl?: string;
  websiteUrl?: string;
  sourceUrl?: string;
  issuesUrl?: string;
  wikiUrl?: string;
  projectType?: string;
  categories?: string[];
  authors?: string[];
  downloads?: number;
  followers?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface ModManagerVersionFile {
  id: string;
  filename: string;
  url: string;
  size: number;
  sha1?: string;
  sha512?: string;
  primary?: boolean;
}

export interface ModManagerProjectVersion {
  id: string;
  name: string;
  versionNumber?: string;
  changelog?: string;
  downloads?: number;
  gameVersions?: string[];
  loaders?: string[];
  publishedAt?: string;
  files?: ModManagerVersionFile[];
}

export interface ModManagerInstallRequest {
  provider: ModManagerProvider;
  projectId: string;
  versionId?: string;
  target?: ModManagerInstallTarget;
}

export interface ModManagerInstallResponse {
  installId: string;
  status: 'queued' | 'downloading' | 'installing' | 'completed' | 'failed';
  message?: string;
}
