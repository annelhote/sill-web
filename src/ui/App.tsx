import { Suspense } from "react";
import { makeStyles, useStyles as useCss } from "@codegouvfr/react-dsfr/tss";
import { useRoute } from "ui/routes";
import { Header } from "ui/shared/Header";
import { Footer } from "ui/shared/Footer";
import { declareComponentKeys } from "i18nifty";
import { useCoreFunctions } from "core";
import { RouteProvider } from "ui/routes";
import { injectGlobalStatesInSearchParams } from "powerhooks/useGlobalState";
import { evtLang } from "ui/i18n";
import {
    addSillApiUrlToQueryParams,
    addTermsOfServiceUrlToQueryParams,
    addIsDarkToQueryParams,
    addAppLocationOriginToQueryParams
} from "keycloak-theme/login/valuesTransferredOverUrl";
import { createCoreProvider } from "core";
import { pages } from "ui/pages";
import { useConst } from "powerhooks/useConst";
import { objectKeys } from "tsafe/objectKeys";
import { useLang } from "ui/i18n";
import { assert } from "tsafe/assert";
import { useIsDark } from "@codegouvfr/react-dsfr/useIsDark";
import { GlobalStyles, keyframes } from "@codegouvfr/react-dsfr/tss";
import { LoadingFallback, loadingFallbackClassName } from "ui/shared/LoadingFallback";
import { useDomRect } from "powerhooks/useDomRect";

let keycloakIsDark: boolean;

const defaultApiUrl = `${window.location.origin}/api`;

const apiUrl = (() => {
    const envValue = process.env["REACT_APP_API_URL"];

    if (envValue === "") {
        //Mock mode
        return "";
    }

    if (envValue === undefined) {
        //Production mode
        return defaultApiUrl;
    }

    //Development mode using local api
    return envValue;
})();

const { CoreProvider } = createCoreProvider({
    apiUrl,
    // prettier-ignore
    "transformUrlBeforeRedirectToLogin": ({ url, termsOfServiceUrl }) =>
        [url]
            .map(injectGlobalStatesInSearchParams)
            .map(url => addSillApiUrlToQueryParams({ url, "value": apiUrl || defaultApiUrl }))
            .map(url => addIsDarkToQueryParams({ url, "value": keycloakIsDark })) 
            .map(url => addTermsOfServiceUrlToQueryParams({ url, "value": termsOfServiceUrl }))
            .map(url => addAppLocationOriginToQueryParams({ url, "value": window.location.origin }))
        [0],
    "getCurrentLang": () => evtLang.state
});

export default function App() {
    const { css } = useCss();

    return (
        <>
            <GlobalStyles
                styles={{
                    "html": {
                        "overflow": "-moz-scrollbars-vertical",
                        "overflowY": "scroll"
                    }
                }}
            />
            <CoreProvider
                fallback={<LoadingFallback className={css({ "height": "100vh" })} />}
            >
                <RouteProvider>
                    <ContextualizedApp />
                </RouteProvider>
            </CoreProvider>
        </>
    );
}

function ContextualizedApp() {
    keycloakIsDark = useIsDark().isDark;

    const route = useRoute();

    const { userAuthentication, sillApiVersion } = useCoreFunctions();

    const headerUserAuthenticationApi = useConst(() =>
        userAuthentication.getIsUserLoggedIn()
            ? {
                  "isUserLoggedIn": true as const,
                  "logout": () => userAuthentication.logout({ "redirectTo": "home" })
              }
            : {
                  "isUserLoggedIn": false as const,
                  "login": () =>
                      userAuthentication.login({ "doesCurrentHrefRequiresAuth": false })
              }
    );

    const {
        ref: headerRef,
        domRect: { height: headerHeight }
    } = useDomRect();

    const { classes } = useStyles({ headerHeight });

    const i18nApi = useLang();

    return (
        <div className={classes.root}>
            <Header
                ref={headerRef}
                routeName={route.name}
                userAuthenticationApi={headerUserAuthenticationApi}
                i18nApi={i18nApi}
            />
            <main className={classes.main}>
                <Suspense fallback={<LoadingFallback />}>
                    {(() => {
                        for (const pageName of objectKeys(pages)) {
                            //You must be able to replace "homepage" by any other page and get no type error.
                            const page = pages[pageName as "homepage"];

                            if (page.routeGroup.has(route)) {
                                if (
                                    page.getDoRequireUserLoggedIn(route) &&
                                    !userAuthentication.getIsUserLoggedIn()
                                ) {
                                    userAuthentication.login({
                                        "doesCurrentHrefRequiresAuth": true
                                    });
                                    return <LoadingFallback />;
                                }

                                return (
                                    <page.LazyComponent
                                        route={route}
                                        className={classes.page}
                                    />
                                );
                            }
                        }

                        return <pages.page404.LazyComponent className={classes.page} />;
                    })()}
                </Suspense>
            </main>
            <Footer
                webVersion={(() => {
                    const webVersion = process.env.VERSION;
                    assert(webVersion !== undefined);
                    return webVersion;
                })()}
                apiVersion={sillApiVersion.getSillApiVersion()}
            />
        </div>
    );
}

const useStyles = makeStyles<{ headerHeight: number }>({
    "name": { App }
})((_theme, { headerHeight }) => ({
    "root": {
        "height": "100vh",
        "display": "flex",
        "flexDirection": "column"
    },
    "main": {
        "flex": 1,
        [`& .${loadingFallbackClassName}`]: {
            "height": `calc(100vh - ${headerHeight}px)`
        }
    },
    "page": {
        "animation": `${keyframes`
            0% {
                opacity: 0;
            }
            100% {
                opacity: 1;
            }
            `} 400ms`
    }
}));

/**
 * "App" key is used for common translation keys
 */
export const { i18n } = declareComponentKeys<
    | "yes"
    | "no"
    | "previous"
    | "next"
    | "add software"
    | "update software"
    | "add software or service"
    | "add instance"
    | "required"
    | "invalid url"
    | "invalid version"
    | "all"
    | "allFeminine"
    | "loading"
    | "no result"
    | "search"
    | "validate"
    | "not provided"
>()({ "App": null });
