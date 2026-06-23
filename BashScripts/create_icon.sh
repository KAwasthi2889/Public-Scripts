#!/usr/bin/env bash

# Ask user for application name if no arguments
if [[ -n "$1" ]]; then
    app_name="$1"
else
    read -rp "Enter the application name: " app_name
fi

# Check if input is empty
if [[ -z "$app_name" ]]; then
    echo "No application name entered. Exiting."
    exit 1
fi


# Search .desktop files
desktop_dirs=(
    # System Wide
    "/usr/share/applications"
    "/usr/local/share/applications"

    # User Side
    "$HOME/.local/share/applications"

    # Flatpak
    "/var/lib/flatpak/exports/share/applications"
    "$HOME/.local/share/flatpak/exports/share/applications/"
)

matches=()

# See if there are any file with Name= given name in desktop dirs
for dir in "${desktop_dirs[@]}"; do
    if [[ -d "$dir" ]]; then
        while IFS= read -r file; do
            # Read the Name= entry
            name=$(grep -m1 "^Name=" "$file" | cut -d'=' -f2-)
            if [[ -n "$name" ]] && [[ "${name,,}" == *"${app_name,,}"* ]]; then
                matches+=("$file")
            fi
            # -L to resolve symlink
        done < <(find -L "$dir" -maxdepth 1 -type f -name "*.desktop")
    fi
done


# Check if we found matches
if [[ ${#matches[@]} -eq 0 ]]; then
    echo "No applications found matching '$app_name'."
    exit 1
fi


# Display matches
echo "Found applications:"
for i in "${!matches[@]}"; do
    display_name=$(grep -m1 "^Name=" "${matches[$i]}" | cut -d'=' -f2-)
    echo "$((i+1))) $display_name"
done


# Ask user to select one
read -rp "Select an application by number: " selection

# Validate selection
if ! [[ "$selection" =~ ^[0-9]+$ ]] || ((selection < 1 || selection > ${#matches[@]})); then
    echo "Invalid selection. Exiting."
    exit 1
fi

selected_file="${matches[$((selection-1))]}"

# Copy to ~/Desktop
desktop_target="$HOME/Desktop/$(basename "$selected_file")"
cp "$selected_file" "$desktop_target"


# Ask for optional filename change
current_filename="$(basename "$desktop_target")"
echo "The shortcut file is currently named: $current_filename"

read -rp "Enter a new filename (without .desktop) or press Enter to keep it: " new_filename
if [[ -n "$new_filename" ]]; then
    new_path="$HOME/Desktop/$new_filename.desktop"
    mv "$desktop_target" "$new_path"
    desktop_target="$new_path"
    echo "File renamed to: $(basename "$desktop_target")"
else
    echo "Keeping original filename."
fi


# Make the file executable and trusted
chmod +x "$desktop_target"
gio set "$desktop_target" "metadata::trusted" true
echo "Shortcut created at $desktop_target and is now executable."