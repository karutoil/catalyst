export interface TemplateVariable {
  name: string;
  description?: string;
  default: string;
  required: boolean;
  input?: 'text' | 'number' | 'select' | 'checkbox';
  rules?: string[];
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  author: string;
  version: string;
  image: string;
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
    [key: string]: any;
  };
}
