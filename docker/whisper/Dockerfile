# Speech to text for the copilot's microphone button: whisper.cpp's server with CUDA, pinned to a release tag.
# Started by  docker compose --profile voice up -d  (the app finds it through WHISPER_URL and hides the microphone
# button when it is not running). The multilingual model understands English and Bengali; it is downloaded on first
# start into the whisper-models volume. No cloud speech service is used anywhere.
FROM nvidia/cuda:12.4.1-devel-ubuntu22.04 AS build
ARG WHISPER_TAG=v1.7.5
RUN apt-get update && apt-get install -y --no-install-recommends git cmake build-essential ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_TAG} https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN cmake -B build -DGGML_CUDA=ON -DWHISPER_BUILD_SERVER=ON -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build -j --target whisper-server

FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY start.sh /start.sh
ENV MODEL_FILE=ggml-large-v3-turbo-q5_0.bin
VOLUME /models
EXPOSE 8080
CMD ["sh", "/start.sh"]
