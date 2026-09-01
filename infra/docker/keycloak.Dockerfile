FROM quay.io/keycloak/keycloak:26.3@sha256:357829ec7c4693397533035092ad13b0644bcc95ded311f33a3738c4d9e9bdba AS builder

ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.3@sha256:357829ec7c4693397533035092ad13b0644bcc95ded311f33a3738c4d9e9bdba

COPY --from=builder /opt/keycloak/ /opt/keycloak/
COPY --chown=keycloak:keycloak infra/keycloak/realm-export.json /opt/keycloak/data/import/realm-export.json

ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true

EXPOSE 8080 9000
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
