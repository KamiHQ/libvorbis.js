emcc -Oz -s ALLOW_MEMORY_GROWTH=1 -s ASM_JS=1 -s EXPORTED_FUNCTIONS='["Module", "_lexy_encoder_start", "_lexy_encoder_write", "_lexy_encoder_finish", "_lexy_get_buffer_length", "_lexy_get_buffer"]' -I libvorbis/include -Llibvorbis/lib/.libs -lvorbis -I libogg/include -Llibogg/src/.libs -lvorbisenc -logg vorbis.cpp -o vorbis.js
