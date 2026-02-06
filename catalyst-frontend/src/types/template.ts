export interface TemplateVariable {
  name: string;
  description?: string;
  default: string;
  required: boolean;
  input?: 'text' | 'number' | 'select' | 'checkbox';
  rules?: string[];
}

export interface TemplateImageOption {
  name: string;
  label?: string;
  image: string;
}

type ModManagerTarget = 'mods' | 'datapacks' | 'modpacks';
type ModManagerProvider =
  | string
  | {
      id: string;
      label?: string;
      game?: string;
      targets?: ModManagerTarget[];
      curseforge?: {
        gameId?: string | number;
        gameSlug?: string;
        classIds?: Partial<Record<ModManagerTarget, string | number>>;
        classSlugs?: Partial<Record<ModManagerTarget, string>>;
        modLoaderMap?: Record<string, string | number>;
      };
    };

export interface Template {
  id: string;
  name: string;
  description?: string;
  author: string;
  version: string;
  image: string;
  images?: TemplateImageOption[];
  defaultImage?: string;
  installImage?: string;
  startup: string;
  stopCommand: string;
  sendSignalTo: string;
  variables: TemplateVariable[];
  installScript?: string;
  supportedPorts: number[];
  allocatedMemoryMb: number;
  allocatedCpuCores: number;
  features?: {
    iconUrl?: string;
    configFile?: string;
    configFiles?: string[];
    modManager?: {
      providers: ModManagerProvider[];
      targets?: ModManagerTarget[];
      paths?: {
        mods?: string;
        datapacks?: string;
        modpacks?: string;
      };
    };
    pluginManager?: {
      providers: string[];
      paths?: {
        plugins?: string;
      };
    };
    [key: string]: any;
  };
}
