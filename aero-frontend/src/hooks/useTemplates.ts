import { useQuery } from '@tanstack/react-query';
import { templatesApi } from '../services/api/templates';

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: templatesApi.list,
  });
}

export function useTemplate(templateId?: string) {
  return useQuery({
    queryKey: ['template', templateId],
    queryFn: () =>
      templateId ? templatesApi.get(templateId) : Promise.reject(new Error('missing template id')),
    enabled: Boolean(templateId),
  });
}
