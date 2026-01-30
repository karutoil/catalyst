import { useQuery } from '@tanstack/react-query';
import { profileApi } from '../services/api/profile';

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: profileApi.getProfile,
  });
}

export function useProfileSsoAccounts() {
  return useQuery({
    queryKey: ['profile-sso-accounts'],
    queryFn: profileApi.listSsoAccounts,
  });
}
