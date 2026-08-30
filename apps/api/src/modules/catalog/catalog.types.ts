import type { ListCatalogServicesQuery, ServiceCatalogItem } from "@contatocerto/shared";

export type CatalogRepository = {
  listServices(query: ListCatalogServicesQuery): Promise<ServiceCatalogItem[]>;
};
