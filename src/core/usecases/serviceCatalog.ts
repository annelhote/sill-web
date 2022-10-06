import "minimal-polyfills/Object.fromEntries";
import type { ThunkAction } from "../setup";
import type { PayloadAction } from "@reduxjs/toolkit";
import { createSelector } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import type { CompiledData } from "sill-api";
import { id } from "tsafe/id";
import { assert } from "tsafe/assert";
import type { ThunksExtraArgument, RootState } from "../setup";
import { waitForDebounceFactory } from "core/tools/waitForDebounce";
import memoize from "memoizee";
import { exclude } from "tsafe/exclude";
import { thunks as catalogThunks, selectors as catalogSelectors } from "./catalog";

type ServiceCatalogExplorerState =
    | ServiceCatalogExplorerState.NotFetched
    | ServiceCatalogExplorerState.Ready;

namespace ServiceCatalogExplorerState {
    export type Common = {
        queryString: string;
    };

    export type NotFetched = Common & {
        stateDescription: "not fetched";
        isFetching: boolean;
    };

    export type Ready = Common & {
        stateDescription: "ready";
        services: CompiledData.Service[];
        isProcessing: boolean;
        "~internal": {
            displayCount: number;
        };
    };
}

export const name = "serviceCatalog";

export const { reducer, actions } = createSlice({
    name,
    "initialState": id<ServiceCatalogExplorerState>(
        id<ServiceCatalogExplorerState.NotFetched>({
            "stateDescription": "not fetched",
            "isFetching": false,
            "queryString": "",
        }),
    ),
    "reducers": {
        "catalogsFetching": state => {
            assert(state.stateDescription === "not fetched");
            state.isFetching = true;
        },
        "catalogsFetched": (
            state,
            {
                payload,
            }: PayloadAction<Pick<ServiceCatalogExplorerState.Ready, "services">>,
        ) => {
            const { services } = payload;

            return id<ServiceCatalogExplorerState.Ready>({
                "stateDescription": "ready",
                services,
                "isProcessing": false,
                "~internal": {
                    "displayCount": 24,
                },
                "queryString": state.queryString,
            });
        },
        "setQueryString": (
            state,
            { payload }: PayloadAction<{ queryString: string }>,
        ) => {
            const { queryString } = payload;

            state.queryString = queryString;

            if (queryString === "" && state.stateDescription === "ready") {
                state["~internal"].displayCount = 24;
            }
        },
        "moreLoaded": state => {
            assert(state.stateDescription === "ready");

            state["~internal"].displayCount += 24;
        },
        "processingStarted": state => {
            assert(state.stateDescription === "ready");

            state.isProcessing = true;
        },
        "serviceAddedOrUpdated": (
            state,
            { payload }: PayloadAction<{ service: CompiledData.Service }>,
        ) => {
            const { service } = payload;

            if (state.stateDescription === "not fetched") {
                return;
            }

            const { services } = state;

            const oldService = services.find(({ id }) => id === service.id);

            if (oldService !== undefined) {
                services[services.indexOf(oldService)!] = service;
            } else {
                services.push(service);
            }
        },
        "serviceDereferenced": (
            state,
            {
                payload,
            }: PayloadAction<{
                serviceId: number;
            }>,
        ) => {
            const { serviceId } = payload;

            if (state.stateDescription === "not fetched") {
                return;
            }

            const service = state.services.find(service => service.id === serviceId);

            assert(service !== undefined);

            state.services.splice(state.services.indexOf(service), 1);

            state.isProcessing = false;
        },
    },
});

export const thunks = {
    "fetchCatalog":
        (): ThunkAction =>
        async (...args) => {
            const [dispatch, getState, { sillApiClient }] = args;

            {
                const state = getState().serviceCatalog;

                if (state.stateDescription === "ready" || state.isFetching) {
                    return;
                }
            }

            dispatch(actions.catalogsFetching());

            //NOTE: We need that to be able to display the name of the service
            if (getState().catalog.stateDescription === "not fetched") {
                dispatch(catalogThunks.fetchCatalog());
            }

            dispatch(
                actions.catalogsFetched({
                    "services": (await sillApiClient.getCompiledData()).services,
                }),
            );
        },
    "setQueryString":
        (params: { queryString: string }): ThunkAction =>
        async (...args) => {
            const { queryString } = params;
            const [dispatch, , extra] = args;

            const sliceContext = getSliceContext(extra);

            const { prevQueryString, waitForSearchDebounce } = sliceContext;

            const prevQuery = pure.parseQuery(prevQueryString);
            const query = pure.parseQuery(queryString);

            sliceContext.prevQueryString = queryString;

            update_softwareId: {
                if (prevQuery.softwareId === query.softwareId) {
                    break update_softwareId;
                }

                dispatch(actions.setQueryString({ queryString }));

                return;
            }

            update_search: {
                if (prevQuery.search === query.search) {
                    break update_search;
                }

                const { search } = query;

                //NOTE: At least 3 character to trigger search
                if (queryString !== "" && search.length <= 2) {
                    break update_search;
                }

                debounce: {
                    //NOTE: We do note debounce if we detect that the search was restored from url or pasted.
                    if (Math.abs(search.length - prevQueryString.length) > 1) {
                        break debounce;
                    }

                    await waitForSearchDebounce();
                }

                dispatch(actions.setQueryString({ queryString }));
            }
        },
    "loadMore":
        (): ThunkAction =>
        async (...args) => {
            const [dispatch, , extraArg] = args;

            const { waitForLoadMoreDebounce } = getSliceContext(extraArg);

            await waitForLoadMoreDebounce();

            dispatch(actions.moreLoaded());
        },
    "getHasMoreToLoad":
        (): ThunkAction<boolean> =>
        (...args) => {
            const [, getState] = args;

            const state = getState().serviceCatalog;

            assert(state.stateDescription === "ready");

            const {
                "~internal": { displayCount },
                services,
            } = state;

            return state.queryString === "" && displayCount < services.length;
        },
    "dereferenceService":
        (params: { serviceId: number }): ThunkAction =>
        async (...args) => {
            const { serviceId } = params;

            const [dispatch, getState, { sillApiClient }] = args;

            const state = getState().serviceCatalog;

            assert(state.stateDescription === "ready");

            const service = state.services.find(service => service.id === serviceId);

            assert(service !== undefined);

            dispatch(actions.processingStarted());

            await sillApiClient.dereferenceService({
                serviceId,
            });

            dispatch(
                actions.serviceDereferenced({
                    serviceId,
                }),
            );
        },
};

export const privateThunks = {
    "initialize":
        (): ThunkAction<void> =>
        (...args) => {
            const [dispatch, , { evtAction }] = args;

            evtAction.attach(
                action =>
                    action.sliceName === "catalog" &&
                    action.actionName === "catalogsFetching",
                () => dispatch(thunks.fetchCatalog()),
            );

            /*
                evtAction.$attach(
                    action =>
                        action.sliceName === "serviceForm" &&
                            action.actionName === "serviceAddedOrUpdated"
                            ? [action.payload.service]
                            : null,
                    service => dispatch(actions.serviceAddedOrUpdated({ service })),
                );
                */
        },
};

const getSliceContext = memoize((_: ThunksExtraArgument) => {
    return {
        "waitForSearchDebounce": waitForDebounceFactory({ "delay": 750 }).waitForDebounce,
        "waitForLoadMoreDebounce": waitForDebounceFactory({ "delay": 50 })
            .waitForDebounce,
        "prevQueryString": "",
    };
});

export const selectors = (() => {
    const getServiceWeight = memoize(
        (service: CompiledData.Service): number => JSON.stringify(service).length,
    );

    const readyState = (
        rootState: RootState,
    ): ServiceCatalogExplorerState.Ready | undefined => {
        const state = rootState.serviceCatalog;
        switch (state.stateDescription) {
            case "ready":
                return state;
            default:
                return undefined;
        }
    };

    const servicesBySoftwareId = createSelector(readyState, state => {
        if (state === undefined) {
            return undefined;
        }

        const servicesBySoftwareId: Record<number, CompiledData.Service[] | undefined> =
            {};

        state.services.forEach(service => {
            if (service.softwareSillId === undefined) {
                return;
            }

            (servicesBySoftwareId[service.softwareSillId] ??= []).push(service);
        });

        return servicesBySoftwareId;
    });

    const filteredServices = createSelector(
        readyState,
        catalogSelectors.readyState,
        (state, softwareCatalogState) => {
            if (state === undefined) {
                return undefined;
            }

            if (softwareCatalogState === undefined) {
                return undefined;
            }

            const {
                queryString,
                services,
                "~internal": { displayCount },
            } = state;

            type ServiceWithSoftwareName = Omit<
                CompiledData.Service,
                "softwareSillId" | "softwareName" | "comptoirDuLibreId"
            > & {
                deployedSoftware: { softwareName: string } & (
                    | {
                          isInSill: true;
                          softwareId: number;
                      }
                    | {
                          isInSill: false;
                          comptoirDuLibreId?: number;
                      }
                );
            };

            const query = pure.parseQuery(queryString);

            return [...services]
                .sort((a, b) => getServiceWeight(b) - getServiceWeight(a))
                .slice(0, queryString === "" ? displayCount : services.length)
                .filter(
                    service =>
                        query.softwareId === undefined ||
                        service.softwareSillId === query.softwareId,
                )
                .map(
                    (service): ServiceWithSoftwareName => ({
                        ...service,
                        "deployedSoftware":
                            service.softwareSillId === undefined
                                ? {
                                      "isInSill": false,
                                      "softwareName": service.softwareName,
                                      "comptoirDuLibreId": service.comptoirDuLibreId,
                                  }
                                : {
                                      "isInSill": true,
                                      "softwareId": service.softwareSillId,
                                      "softwareName": (() => {
                                          const software =
                                              softwareCatalogState.softwares.find(
                                                  software => software.id === service.id,
                                              );

                                          assert(software !== undefined);

                                          return software.name;
                                      })(),
                                  },
                    }),
                )
                .filter(
                    query.search === ""
                        ? () => true
                        : ({
                              agencyName,
                              agencyUrl,
                              contentModerationMethod,
                              description,
                              lastUpdateDate,
                              publicSector,
                              publicationDate,
                              serviceName,
                              serviceUrl,
                              signupScope,
                              signupValidationMethod,
                              usageScope,
                              deployedSoftware,
                          }) =>
                              [
                                  agencyName,
                                  agencyUrl,
                                  contentModerationMethod,
                                  description,
                                  lastUpdateDate,
                                  publicSector,
                                  publicationDate,
                                  serviceName,
                                  serviceUrl,
                                  signupScope,
                                  signupValidationMethod,
                                  usageScope,
                                  deployedSoftware.softwareName,
                              ]
                                  .map(e => (!!e ? e : undefined))
                                  .filter(exclude(undefined))
                                  .map(str => {
                                      const format = (str: string) =>
                                          str
                                              .normalize("NFD")
                                              .replace(/[\u0300-\u036f]/g, "")
                                              .toLowerCase();

                                      return format(str).includes(format(query.search));
                                  })
                                  .indexOf(true) >= 0,
                );
        },
    );

    const searchResultCount = createSelector(
        readyState,
        filteredServices,
        (state, filteredSoftwares) => {
            if (state === undefined) {
                return undefined;
            }

            assert(filteredSoftwares !== undefined);

            const { queryString } = state;

            return queryString !== "" ? filteredSoftwares.length : state.services.length;
        },
    );

    return {
        filteredServices,
        searchResultCount,
        servicesBySoftwareId,
    };
})();

export type Query = {
    search: string;
    softwareId: number | undefined;
};

export const pure = (() => {
    function parseQuery(queryString: string): Query {
        if (!queryString.startsWith("{")) {
            return {
                "search": queryString,
                "softwareId": undefined,
            };
        }

        return JSON.parse(queryString);
    }

    function stringifyQuery(query: Query) {
        if (query.search === "" && query.softwareId === undefined) {
            return "";
        }

        if (query.softwareId !== undefined) {
            return query.search;
        }

        return JSON.stringify(query);
    }

    return { stringifyQuery, parseQuery };
})();
