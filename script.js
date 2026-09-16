document.addEventListener('DOMContentLoaded', function() {
    const gallery = document.querySelector('.gallery');
    const addCard = document.getElementById('add-card');
    const modal = document.getElementById('upload-modal');
    const imageUrlInput = document.getElementById('image-url');
    const imageTitleInput = document.getElementById('image-title');
    const cancelBtn = document.getElementById('cancel-btn');
    const addBtn = document.getElementById('add-btn');
    const uploadError = document.getElementById('upload-error');

    // Load saved custom images from localStorage
    function loadCustomImages() {
        const customImages = JSON.parse(localStorage.getItem('customImages') || '[]');
        customImages.forEach(img => {
            addCustomImageCard(img.url, img.title, img.id);
        });
        // Re-add the add card at the end
        if (!document.getElementById('add-card')) {
            addAddCardToEnd();
        }
    }

    // Generate unique ID for custom images
    function generateId() {
        return 'custom_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    }

    // Add custom image card to gallery
    function addCustomImageCard(imageUrl, title, id) {
        const card = document.createElement('div');
        card.className = 'card';
        card.setAttribute('data-custom-id', id);
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = title || 'Custom Image';
        img.setAttribute('data-image', id);
        img.setAttribute('data-custom', 'true');
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'title';
        titleDiv.textContent = title || 'Untitled';
        
        const descDiv = document.createElement('div');
        descDiv.className = 'description';
        descDiv.textContent = 'Custom image';
        
        card.appendChild(img);
        card.appendChild(titleDiv);
        card.appendChild(descDiv);
        
        // Insert before the add card
        const addCardElement = document.getElementById('add-card');
        if (addCardElement) {
            gallery.insertBefore(card, addCardElement);
        } else {
            gallery.appendChild(card);
        }
    }

    // Add the add card to the end of the gallery
    function addAddCardToEnd() {
        const existingAddCard = document.getElementById('add-card');
        if (existingAddCard) {
            existingAddCard.remove();
        }
        
        const card = document.createElement('div');
        card.className = 'card add-card';
        card.id = 'add-card';
        card.innerHTML = `
            <div class="add-icon">+</div>
            <div class="title">Add Image</div>
            <div class="description">Upload your own image URL</div>
        `;
        gallery.appendChild(card);
        
        // Re-attach event listener
        card.addEventListener('click', openUploadModal);
    }

    // Open upload modal
    function openUploadModal() {
        modal.classList.add('active');
        imageUrlInput.value = '';
        imageTitleInput.value = '';
        uploadError.textContent = '';
        // Select manual title by default
        document.querySelector('input[name="title-source"][value="manual"]').checked = true;
        imageUrlInput.focus();
    }

    // Close upload modal
    function closeUploadModal() {
        modal.classList.remove('active');
    }

    // Save custom image to localStorage
    function saveCustomImage(imageUrl, title, id) {
        const customImages = JSON.parse(localStorage.getItem('customImages') || '[]');
        customImages.push({ url: imageUrl, title: title, id: id });
        localStorage.setItem('customImages', JSON.stringify(customImages));
    }

    // Add image from modal
    async function addImageFromModal() {
        const imageUrl = imageUrlInput.value.trim();
        const titleSource = document.querySelector('input[name="title-source"]:checked').value;
        const manualTitle = imageTitleInput.value.trim();
        
        if (!imageUrl) {
            uploadError.textContent = 'Please enter an image URL';
            return;
        }
        
        // Validate URL
        try {
            new URL(imageUrl);
        } catch {
            uploadError.textContent = 'Please enter a valid URL';
            return;
        }
        
        // If auto title is selected but no manual title, we need to generate one
        let title = manualTitle;
        if (titleSource === 'auto' && !manualTitle) {
            // We'll generate the title after validating the image
        } else if (titleSource === 'manual' && !manualTitle) {
            uploadError.textContent = 'Please enter a title';
            return;
        }
        
        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';
        
        try {
            const id = generateId();
            
            // If auto title is selected, generate it first
            if (titleSource === 'auto' && !manualTitle) {
                const titleResponse = await fetch('/api/generate-title', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        imageUrl: imageUrl
                    })
                });
                
                if (!titleResponse.ok) {
                    const errorData = await titleResponse.json();
                    throw new Error(errorData.error || 'Failed to generate title');
                }
                
                const titleData = await titleResponse.json();
                title = titleData.title || 'Untitled';
            }
            
            // Generate description
            const response = await fetch('/api/generate-description', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    imageName: id,
                    imageUrl: imageUrl,
                    forceRegenerate: true
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to generate description');
            }
            
            const data = await response.json();
            
            // Save to localStorage
            saveCustomImage(imageUrl, title || 'Untitled', id);
            
            // Add card to gallery
            addCustomImageCard(imageUrl, title || 'Untitled', id);
            
            // Remove old add card and add new one at end
            addAddCardToEnd();
            
            closeUploadModal();
            
        } catch (error) {
            uploadError.textContent = error.message;
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = 'Add Image';
        }
    }

    // Gallery click handler - navigate to image page or open modal
    gallery.addEventListener('click', function(e) {
        const card = e.target.closest('.card');
        if (!card) return;
        
        e.preventDefault();
        e.stopPropagation();
        
        // Check if it's the add card
        if (card.classList.contains('add-card')) {
            openUploadModal();
            return;
        }
        
        const img = card.querySelector('img');
        if (img) {
            const imageName = img.getAttribute('data-image');
            const isCustom = img.getAttribute('data-custom') === 'true';
            
            if (imageName) {
                if (isCustom) {
                    // For custom images, pass the URL directly
                    const imageUrl = img.src;
                    const title = card.querySelector('.title').textContent;
                    window.location.href = `image.html?name=${encodeURIComponent(imageName)}&url=${encodeURIComponent(imageUrl)}&title=${encodeURIComponent(title)}&custom=true`;
                } else {
                    window.location.href = 'image.html?name=' + encodeURIComponent(imageName);
                }
            }
        }
    });
    
    // Modal event listeners
    addCard.addEventListener('click', openUploadModal);
    cancelBtn.addEventListener('click', closeUploadModal);
    addBtn.addEventListener('click', addImageFromModal);
    
    // Close modal on background click
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeUploadModal();
        }
    });
    
    // Close modal on Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && modal.classList.contains('active')) {
            closeUploadModal();
        }
    });
    
    // Load custom images on page load
    loadCustomImages();
    
    document.documentElement.dataset.ready = "true";
});
