import { assert } from "tsafe/assert";
import type { ThunkAction, State as RootState } from "../core";
import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { id } from "tsafe/id";

type State = State.NotInitialized | State.Ready;

namespace State {
    export type NotInitialized = {
        stateDescription: "not initialized";
        isInitializing: boolean;
    };

    export type Ready = {
        stateDescription: "ready";
        passwordResetUrl: string | undefined;
        allowedEmailRegexpStr: string;
        allOrganizations: string[];
        organization: {
            value: string;
            isBeingUpdated: boolean;
        };
        email: {
            value: string;
            isBeingUpdated: boolean;
        };
    };
}

export const name = "userAccountManagement";

export const { reducer, actions } = createSlice({
    name,
    "initialState": id<State>({
        "stateDescription": "not initialized",
        "isInitializing": false
    }),
    "reducers": {
        "initializeStarted": state => {
            assert(state.stateDescription === "not initialized");

            state.isInitializing = true;
        },
        "initialized": (
            _state,
            {
                payload
            }: PayloadAction<{
                passwordResetUrl: string | undefined;
                allowedEmailRegexpStr: string;
                organization: string;
                email: string;
                allOrganizations: string[];
            }>
        ) => {
            const {
                passwordResetUrl,
                allowedEmailRegexpStr,
                organization,
                email,
                allOrganizations
            } = payload;

            return {
                "stateDescription": "ready",
                passwordResetUrl,
                allowedEmailRegexpStr,
                allOrganizations,
                "organization": {
                    "value": organization,
                    "isBeingUpdated": false
                },
                "email": {
                    "value": email,
                    "isBeingUpdated": false
                }
            };
        },
        "updateFieldStarted": (
            state,
            {
                payload
            }: PayloadAction<{
                fieldName: "organization" | "email";
                value: string;
            }>
        ) => {
            const { fieldName, value } = payload;

            assert(state.stateDescription === "ready");

            state[fieldName] = {
                value,
                "isBeingUpdated": true
            };
        },
        "updateFieldCompleted": (
            state,
            {
                payload
            }: PayloadAction<{
                fieldName: "organization" | "email";
            }>
        ) => {
            const { fieldName } = payload;

            assert(state.stateDescription === "ready");

            state[fieldName].isBeingUpdated = false;
        }
    }
});

export const thunks = {
    "initialize":
        (): ThunkAction =>
        async (...args) => {
            const [dispatch, getState, { oidc, getUser, sillApi }] = args;

            {
                const state = getState()[name];

                if (state.stateDescription === "ready" || state.isInitializing) {
                    return;
                }
            }

            dispatch(actions.initializeStarted());

            assert(oidc.isUserLoggedIn);

            const [user, { keycloakParams }, allowedEmailRegexpStr, allOrganizations] =
                await Promise.all([
                    getUser(),
                    sillApi.getOidcParams(),
                    sillApi.getAllowedEmailRegexp(),
                    sillApi.getAllOrganizations()
                ]);

            dispatch(
                actions.initialized({
                    allowedEmailRegexpStr,
                    "email": user.email,
                    "organization": user.organization,
                    "passwordResetUrl":
                        keycloakParams === undefined
                            ? undefined
                            : [
                                  keycloakParams.url.replace(/\/$/, ""),
                                  "realms",
                                  keycloakParams.realm,
                                  "account",
                                  "password"
                              ].join("/"),
                    allOrganizations
                })
            );
        },
    "updateField":
        (params: { fieldName: "organization" | "email"; value: string }): ThunkAction =>
        async (...args) => {
            const { fieldName, value } = params;
            const [dispatch, , { sillApi, oidc }] = args;

            dispatch(actions.updateFieldStarted({ fieldName, value }));

            switch (fieldName) {
                case "organization":
                    await sillApi.changeAgentOrganization({ "newOrganization": value });
                    break;
                case "email":
                    await sillApi.updateEmail({ "newEmail": value });
                    break;
            }

            assert(oidc.isUserLoggedIn);

            await oidc.updateTokenInfo();

            dispatch(actions.updateFieldCompleted({ fieldName }));
        }
};

export const selectors = (() => {
    const readyState = (rootState: RootState) => {
        const state = rootState[name];

        if (state.stateDescription !== "ready") {
            return undefined;
        }

        const { stateDescription, ...rest } = state;

        return rest;
    };

    return { readyState };
})();
